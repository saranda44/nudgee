/**
 * Pruebas de carga de Nudgee (NFR-10, docs/observabilidad.md §5). Guarda Shorts por el camino real
 * (API Gateway → Ingesta E-05 → SQS FIFO → worker-ia) con usuarios de prueba, para que el dashboard
 * muestre la cola subiendo con worker-ia fijo en concurrencia 2.
 *
 * Requiere `terraform apply -var load_test_enabled=true` (crea el app client) y credenciales del lab.
 *
 *   node scripts/load-test/index.ts warmup  --videos pool.txt [--yes]
 *   node scripts/load-test/index.ts run     --videos pool.txt [--users 35] [--per-user 25] [--rate 15] [--max-requests 900] [--yes]
 *   node scripts/load-test/index.ts cleanup [--yes]
 *
 * Costo de Gemini: `run` SOLO usa videos con caché OK en DynamoDB (cache hit, sin Gemini). Gemini
 * solo se llama en `warmup`, una vez por video sin caché, de a uno y con tope (--max-gemini).
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { buildPlan, parseVideoPool, percentile, shouldAbort } from "./plan.ts";

const USER_PREFIX = "loadtest-";
const WARMUP_EMAIL = `${USER_PREFIX}warmup@example.com`;
const MAX_IN_FLIGHT = 100;

interface LoadTestConfig {
  environment: string;
  api_endpoint: string;
  user_pool_id: string;
  client_id: string;
  table_name: string;
  queue_url: string;
}

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    videos: { type: "string" },
    users: { type: "string", default: "35" },
    "per-user": { type: "string", default: "25" },
    rate: { type: "string", default: "15" },
    "max-requests": { type: "string", default: "900" },
    "max-gemini": { type: "string", default: "30" },
    "analysis-version": { type: "string", default: "1" },
    yes: { type: "boolean", default: false },
  },
});

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function intArg(name: keyof typeof args): number {
  const n = Number(args[name]);
  if (!Number.isInteger(n) || n <= 0) fail(`--${name} debe ser un entero positivo`);
  return n;
}

/** Lee el output `load_test` de Terraform: así el script siempre apunta al stack desplegado. */
function loadConfig(): LoadTestConfig {
  const infraDir = fileURLToPath(new URL("../../../infra", import.meta.url));
  let raw: string;
  try {
    raw = execFileSync("terraform", [`-chdir=${infraDir}`, "output", "-json", "load_test"], { encoding: "utf8" });
  } catch {
    fail("No hay `terraform output load_test`: aplica con -var load_test_enabled=true (y terraform init en infra/)");
  }
  const config = JSON.parse(raw) as LoadTestConfig | null;
  if (!config) fail("load_test es null: aplica Terraform con -var load_test_enabled=true");
  return config;
}

function loadPool(): string[] {
  if (!args.videos) fail("Falta --videos <archivo> (un videoId de Shorts por línea)");
  const { videos, invalid } = parseVideoPool(readFileSync(args.videos, "utf8"));
  if (invalid.length) console.warn(`⚠ Ignoro líneas que no son videoId: ${invalid.join(", ")}`);
  if (!videos.length) fail("El pool está vacío");
  return videos;
}

function confirm(summary: string): void {
  console.log(summary);
  if (!args.yes) {
    console.log("\nNo se hizo nada. Repite con --yes para ejecutarlo.");
    process.exit(0);
  }
}

// ---------- Cognito ----------

function randomPassword(): string {
  // Cumple la política del pool (mayúscula, minúscula, número y símbolo); nueva en cada corrida.
  return `Lt-${randomBytes(18).toString("base64url")}aA9!`;
}

/** Crea el usuario si no existe, le pone una contraseña nueva y devuelve su access token y sub. */
async function signIn(config: LoadTestConfig, email: string): Promise<{ token: string; sub: string }> {
  const password = randomPassword();
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: config.user_pool_id,
        Username: email,
        MessageAction: "SUPPRESS", // sin correo de bienvenida
        TemporaryPassword: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof UsernameExistsException)) throw error;
  }
  await cognito.send(
    new AdminSetUserPasswordCommand({ UserPoolId: config.user_pool_id, Username: email, Password: password, Permanent: true }),
  );
  // Dispara Post Authentication: crea el PROFILE igual que un login normal (scheduleState NONE).
  const auth = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: config.user_pool_id,
      ClientId: config.client_id,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  const token = auth.AuthenticationResult?.AccessToken;
  if (!token) fail(`Cognito no devolvió token para ${email}`);
  const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub as string;
  return { token, sub };
}

// ---------- API y DynamoDB ----------

async function saveShort(config: LoadTestConfig, token: string, videoId: string, correlationId: string) {
  const started = performance.now();
  try {
    const res = await fetch(`${config.api_endpoint}/v1/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Correlation-Id": correlationId },
      body: JSON.stringify({ url: `https://youtube.com/shorts/${videoId}` }),
    });
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - started };
  } catch {
    return { status: 0, ms: performance.now() - started }; // fallo de red
  }
}

/** Mismo criterio que worker-ia/dynamo.ts: PK VIDEO#id, SK ANALYSIS#v{n}, ignorando vencidos. */
async function cacheResult(config: LoadTestConfig, videoId: string): Promise<"OK" | "UNAVAILABLE" | null> {
  const { Item } = await ddb.send(
    new GetCommand({
      TableName: config.table_name,
      Key: { PK: `VIDEO#${videoId}`, SK: `ANALYSIS#v${args["analysis-version"]}` },
      ConsistentRead: true,
    }),
  );
  if (!Item) return null;
  if (typeof Item.expiresAt === "number" && Item.expiresAt < Date.now() / 1000) return null;
  return Item.result === "OK" ? "OK" : "UNAVAILABLE";
}

async function itemStatus(config: LoadTestConfig, sub: string, videoId: string): Promise<string | undefined> {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: config.table_name, Key: { PK: `USER#${sub}`, SK: `ITEM#${videoId}` }, ConsistentRead: true }),
  );
  return Item?.status as string | undefined;
}

async function queueDepth(config: LoadTestConfig): Promise<{ visible: number; inFlight: number }> {
  const { Attributes = {} } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: config.queue_url,
      AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    }),
  );
  return { visible: Number(Attributes.ApproximateNumberOfMessages ?? 0), inFlight: Number(Attributes.ApproximateNumberOfMessagesNotVisible ?? 0) };
}

async function classifyPool(config: LoadTestConfig, videos: string[]) {
  const cached: string[] = [];
  const unavailable: string[] = [];
  const missing: string[] = [];
  for (const v of videos) {
    const r = await cacheResult(config, v);
    (r === "OK" ? cached : r === "UNAVAILABLE" ? unavailable : missing).push(v);
  }
  return { cached, unavailable, missing };
}

// ---------- Comandos ----------

/** Llena la caché de análisis, un video a la vez (evita el 429 de la cuota gratuita de Gemini). */
async function warmup(): Promise<void> {
  const config = loadConfig();
  const pool = loadPool();
  const { cached, unavailable, missing } = await classifyPool(config, pool);
  const maxGemini = intArg("max-gemini");
  if (missing.length > maxGemini) fail(`${missing.length} videos sin caché rebasan --max-gemini ${maxGemini}`);
  confirm(
    [
      `Stack: ${config.environment}`,
      `Pool: ${pool.length} videos — ${cached.length} ya en caché, ${unavailable.length} no disponibles, ${missing.length} sin caché.`,
      `Gemini se llamará como máximo ${missing.length} veces (una por video sin caché, de una en una).`,
    ].join("\n"),
  );
  if (!missing.length) return console.log("✔ Nada que calentar: todo el pool ya está en caché.");

  const { token, sub } = await signIn(config, WARMUP_EMAIL);
  for (const [i, videoId] of missing.entries()) {
    const { status } = await saveShort(config, token, videoId, `loadtest-warmup-${videoId}`);
    if (status !== 202 && status !== 409) {
      console.log(`  ${videoId}: HTTP ${status}, lo salto`);
      continue;
    }
    // Espera a que el worker termine: caché OK, o el ítem sale de PROCESSING sin caché.
    let result: string = "sin respuesta en 3 min";
    for (let t = 0; t < 60; t++) {
      await sleep(3000);
      if ((await cacheResult(config, videoId)) === "OK") {
        result = "caché OK";
        break;
      }
      const s = await itemStatus(config, sub, videoId);
      if (s && s !== "PROCESSING") {
        result = `${s} sin caché (confianza baja o salida inválida): no usarlo en run`;
        break;
      }
    }
    console.log(`  [${i + 1}/${missing.length}] ${videoId}: ${result}`);
  }
  const after = await classifyPool(config, pool);
  console.log(`✔ Warmup terminado: ${after.cached.length}/${pool.length} videos con caché OK.`);
}

/** La ráfaga: solo videos con caché OK, así que no llama a Gemini. */
async function run(): Promise<void> {
  const config = loadConfig();
  const pool = loadPool();
  const { cached, unavailable, missing } = await classifyPool(config, pool);
  if (unavailable.length + missing.length) {
    console.warn(`⚠ Excluyo ${unavailable.length + missing.length} videos sin caché OK (correr warmup): ${[...unavailable, ...missing].join(", ")}`);
  }
  if (!cached.length) fail("Ningún video del pool tiene caché OK: corre primero `warmup`");

  const users = intArg("users");
  const rate = intArg("rate");
  const plan = buildPlan(users, cached, intArg("per-user"), intArg("max-requests"));
  confirm(
    [
      `Stack: ${config.environment}`,
      `Ráfaga: ${plan.length} guardados de ${users} usuarios sobre ${cached.length} videos en caché (0 llamadas a Gemini).`,
      `Ritmo: ${rate} req/s → ~${Math.ceil(plan.length / rate)} s enviando.`,
    ].join("\n"),
  );

  console.log(`Iniciando sesión con ${users} usuarios de prueba…`);
  const tokens: string[] = [];
  for (let u = 0; u < users; u++) {
    tokens.push((await signIn(config, `${USER_PREFIX}${String(u + 1).padStart(2, "0")}@example.com`)).token);
  }

  const runId = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const statuses = new Map<number, number>();
  const latencies: number[] = [];
  let done = 0;
  let serverErrors = 0;
  let inFlight = 0;
  let aborted = false;
  let sending = true;
  let peak = 0;

  // Monitor de la cola cada 5 s, mientras se envía y hasta que se vacía (máx. 10 min).
  const monitor = (async () => {
    const until = Date.now() + 10 * 60 * 1000;
    while (Date.now() < until) {
      const { visible, inFlight: processing } = await queueDepth(config);
      peak = Math.max(peak, visible);
      console.log(`  cola: ${visible} visibles, ${processing} en proceso — enviados ${done}/${plan.length}`);
      if (!sending && visible + processing === 0) return;
      await sleep(5000);
    }
    console.warn("⚠ La cola no se vació en 10 min; revisa el dashboard");
  })();

  const started = Date.now();
  const pending: Promise<void>[] = [];
  for (const [i, req] of plan.entries()) {
    if (aborted) break;
    const wait = started + (i * 1000) / rate - Date.now();
    if (wait > 0) await sleep(wait);
    while (inFlight >= MAX_IN_FLIGHT) await sleep(20);
    inFlight++;
    pending.push(
      saveShort(config, tokens[req.userIndex], req.videoId, `loadtest-${runId}-${i}`).then(({ status, ms }) => {
        inFlight--;
        done++;
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
        latencies.push(ms);
        if (status === 0 || status >= 500) serverErrors++;
        if (!aborted && shouldAbort(done, serverErrors)) {
          aborted = true;
          console.error(`✖ Más del 5 % de errores del servidor (${serverErrors}/${done}): corto la ráfaga`);
        }
      }),
    );
  }
  await Promise.all(pending);
  sending = false;
  const sendSeconds = (Date.now() - started) / 1000;
  await monitor;

  const byStatus = [...statuses.entries()].sort(([a], [b]) => a - b).map(([s, n]) => `${s === 0 ? "red" : s}: ${n}`);
  console.log(
    [
      "",
      `Resultado (${aborted ? "ABORTADA" : "completa"}), correlationId loadtest-${runId}-*`,
      `  enviados: ${done} en ${sendSeconds.toFixed(0)} s — ${byStatus.join(", ")}`,
      `  latencia cliente: p50 ${percentile(latencies, 50).toFixed(0)} ms, p95 ${percentile(latencies, 95).toFixed(0)} ms, p99 ${percentile(latencies, 99).toFixed(0)} ms`,
      `  pico de la cola: ${peak} mensajes visibles`,
      (statuses.get(409) ?? 0) > done / 2 ? "  ⚠ Muchos 409: estos usuarios ya tenían los videos. Corre `cleanup` antes de repetir." : "",
      "Al terminar la demo: node scripts/load-test/index.ts cleanup --yes",
    ].filter(Boolean).join("\n"),
  );
}

/** Borra los usuarios loadtest-* de Cognito y su partición USER#{sub} en DynamoDB. La caché de videos se queda. */
async function cleanup(): Promise<void> {
  const config = loadConfig();
  const found: { username: string; sub: string }[] = [];
  let token: string | undefined;
  do {
    const page = await cognito.send(
      new ListUsersCommand({ UserPoolId: config.user_pool_id, Filter: `email ^= "${USER_PREFIX}"`, PaginationToken: token }),
    );
    for (const u of page.Users ?? []) {
      const sub = u.Attributes?.find((a) => a.Name === "sub")?.Value;
      if (u.Username && sub) found.push({ username: u.Username, sub });
    }
    token = page.PaginationToken;
  } while (token);
  confirm(`Stack: ${config.environment}\nSe borrarán ${found.length} usuarios ${USER_PREFIX}* y todos sus datos en ${config.table_name}.`);

  let deletedRows = 0;
  for (const { username, sub } of found) {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const page = await ddb.send(
        new QueryCommand({
          TableName: config.table_name,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": `USER#${sub}` },
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey: lastKey,
        }),
      );
      const keys = page.Items ?? [];
      for (let i = 0; i < keys.length; i += 25) {
        let requests: Record<string, unknown>[] | undefined = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
        for (let attempt = 0; requests?.length && attempt < 5; attempt++) {
          if (attempt) await sleep(200 * 2 ** attempt);
          const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [config.table_name]: requests as never } }));
          requests = res.UnprocessedItems?.[config.table_name] as Record<string, unknown>[] | undefined;
        }
        if (requests?.length) fail(`DynamoDB no procesó ${requests.length} borrados de ${username}; repite cleanup`);
      }
      deletedRows += keys.length;
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: config.user_pool_id, Username: username }));
  }
  console.log(`✔ Borrados ${found.length} usuarios y ${deletedRows} registros de DynamoDB.`);
}

const commands: Record<string, () => Promise<void>> = { warmup, run, cleanup };
const command = commands[positionals[0] ?? ""];
if (!command) fail("Uso: node scripts/load-test/index.ts <warmup|run|cleanup> [opciones] (ver encabezado del archivo)");
await command();
