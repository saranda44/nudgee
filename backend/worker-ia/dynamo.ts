import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

/** Arma un UpdateExpression "SET" seguro (alias para cada nombre y valor, sin pelear con palabras reservadas). */
function buildSetExpression(fields: Record<string, unknown>): {
  updateExpression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  let i = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const nameAlias = `#f${i}`;
    const valueAlias = `:v${i}`;
    names[nameAlias] = key;
    values[valueAlias] = value;
    sets.push(`${nameAlias} = ${valueAlias}`);
    i += 1;
  }
  return { updateExpression: `SET ${sets.join(", ")}`, names, values };
}

export interface CacheEntry {
  result: "OK" | "UNAVAILABLE";
  analysis?: unknown;
  confidence?: number;
  model?: string;
}

/** lectura consistente de la caché global; se ignora si `expiresAt` ya venció. */
export async function readAnalysisCache(videoId: string, analysisVersion: number, now: Date): Promise<CacheEntry | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `VIDEO#${videoId}`, SK: `ANALYSIS#v${analysisVersion}` },
      ConsistentRead: true,
    }),
  );
  const item = result.Item;
  if (!item) return null;
  if (typeof item.expiresAt === "number" && item.expiresAt < Math.floor(now.getTime() / 1000)) return null;
  return { result: item.result, analysis: item.analysis, confidence: item.confidence, model: item.model };
}

export interface WriteCacheInput {
  videoId: string;
  analysisVersion: number;
  result: "OK" | "UNAVAILABLE";
  analysis?: unknown;
  confidence?: number;
  model: string;
  correlationId: string;
  now: Date;
  ttlSeconds: number;
}

/** red de seguridad, no la exclusión mutua (esa la da SQS FIFO con MessageGroupId=videoId). */
export async function writeAnalysisCache(input: WriteCacheInput): Promise<void> {
  const nowEpoch = Math.floor(input.now.getTime() / 1000);
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `VIDEO#${input.videoId}`,
          SK: `ANALYSIS#v${input.analysisVersion}`,
          entityType: "ANALYSIS_CACHE",
          videoId: input.videoId,
          analysisVersion: input.analysisVersion,
          result: input.result,
          ...(input.analysis !== undefined ? { analysis: input.analysis } : {}),
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
          model: input.model,
          createdAt: input.now.toISOString(),
          correlationId: input.correlationId,
          expiresAt: nowEpoch + input.ttlSeconds,
        },
        ConditionExpression: "attribute_not_exists(PK) OR expiresAt < :now",
        ExpressionAttributeValues: { ":now": nowEpoch },
      }),
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    // Alguien más ya dejó una entrada vigente; no es un error (red de seguridad, no la exclusión mutua).
  }
}

export interface AnalysisForItem {
  category: string;
  title: string;
  summary?: string;
  details?: { eventDate?: string } & Record<string, unknown>;
}

export interface MarkPendingInput {
  userId: string;
  videoId: string;
  savedAt: string;
  analysis: AnalysisForItem;
  confidence: number;
  analysisSource: "GEMINI" | "CACHE";
  now: Date;
}

/**
 * transición PROCESSING -> PENDING con el resultado del análisis.
 * entra a GSI1 (GSI1PK=USER#{userId}, GSI1SK={savedAt}#{videoId}).
 * en EVENT, eventDate también de primer nivel, misma UpdateExpression.
 * Si el ítem ya no está en PROCESSING (otro intento ya lo resolvió), no se sobrescribe.
 */
export async function markItemPending(input: MarkPendingInput): Promise<{ skipped: boolean }> {
  const nowIso = input.now.toISOString();
  const eventDate = input.analysis.category === "EVENT" ? input.analysis.details?.eventDate : undefined;

  const { updateExpression, names, values } = buildSetExpression({
    category: input.analysis.category,
    title: input.analysis.title,
    summary: input.analysis.summary,
    details: input.analysis.details,
    confidence: input.confidence,
    dataSource: "AI",
    analysisSource: input.analysisSource,
    aiOriginal: input.analysis,
    readyAt: nowIso,
    statusUpdatedAt: nowIso,
    status: "PENDING",
    GSI1PK: `USER#${input.userId}`,
    GSI1SK: `${input.savedAt}#${input.videoId}`,
    ...(eventDate !== undefined ? { eventDate } : {}),
  });

  return runConditionalUpdate(input.userId, input.videoId, updateExpression, { ...names, "#currentStatus": "status" }, values, "#currentStatus = :expectedStatus", "PROCESSING");
}

export interface MarkNeedsInputInput {
  userId: string;
  videoId: string;
  analysisError: "AI_ERROR" | "RETRIES_EXHAUSTED" | "VIDEO_UNAVAILABLE" | "INVALID_OUTPUT";
  now: Date;
}

/** fallos controlados del worker llevan el ítem a NEEDS_INPUT, condicionado a que siga en PROCESSING. */
export async function markItemNeedsInput(input: MarkNeedsInputInput): Promise<{ skipped: boolean }> {
  const nowIso = input.now.toISOString();
  const { updateExpression, names, values } = buildSetExpression({
    status: "NEEDS_INPUT",
    analysisError: input.analysisError,
    statusUpdatedAt: nowIso,
  });

  return runConditionalUpdate(input.userId, input.videoId, updateExpression, { ...names, "#currentStatus": "status" }, values, "#currentStatus = :expectedStatus", "PROCESSING");
}

async function runConditionalUpdate(
  userId: string,
  videoId: string,
  updateExpression: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
  conditionExpression: string,
  expectedStatus: string,
): Promise<{ skipped: boolean }> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `ITEM#${videoId}` },
        UpdateExpression: updateExpression,
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ":expectedStatus": expectedStatus },
      }),
    );
    return { skipped: false };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    return { skipped: true };
  }
}
