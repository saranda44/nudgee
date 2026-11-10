/**
 * E-01 GET /v1/health y E-02 GET /v1/config.
 */

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Route } from "./router.ts";

const APP_VERSION = "1.0.0";
const VAPID_PUBLIC_KEY_PARAMETER = "/nudgee/VAPID_PUBLIC_KEY";

const ssmClient = new SSMClient({});
let cachedVapidPublicKey: string | undefined;

async function getVapidPublicKey(): Promise<string> {
  if (cachedVapidPublicKey) return cachedVapidPublicKey;
  const result = await ssmClient.send(
    new GetParameterCommand({ Name: VAPID_PUBLIC_KEY_PARAMETER, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`${VAPID_PUBLIC_KEY_PARAMETER} no está configurado en SSM`);
  cachedVapidPublicKey = value;
  return cachedVapidPublicKey;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export const systemRoutes: Route[] = [
  {
    method: "GET",
    path: "/v1/health",
    auth: false,
    handler: async () => ({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok", version: APP_VERSION, time: new Date().toISOString() }),
    }),
  },
  {
    method: "GET",
    path: "/v1/config",
    auth: true,
    handler: async () => {
      const vapidPublicKey = await getVapidPublicKey();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
        body: JSON.stringify({
          vapidPublicKey,
          reminderSlots: parseCsv(process.env.REMINDER_SLOTS, ["09:00", "14:00", "19:00"]),
          snoozeOptions: parseCsv(process.env.SNOOZE_OPTIONS, ["1", "3", "5"]).map(Number),
          snoozeUnit: process.env.SNOOZE_UNIT ?? "DAY",
          discardRetentionDays: parseNumber(process.env.DISCARD_RETENTION_DAYS, 30),
          pollingIntervalMs: parseNumber(process.env.POLLING_INTERVAL_MS, 4000),
          pollingMaxDurationMs: parseNumber(process.env.POLLING_MAX_DURATION_MS, 120000),
        }),
      };
    },
  },
];
