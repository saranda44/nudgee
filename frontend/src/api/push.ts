/** E-20, E-21 (Push subscriptions, US-35). */

import { api } from "./client.ts";

interface SubscribeBody {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  platform?: string;
}

/** E-20: upsert por endpoint (201 Created si es nueva, 200 OK si ya existía, NTF-02). */
export async function registerPushSubscription(subscription: PushSubscription): Promise<string> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("La suscripción del navegador no trae endpoint o keys.");
  }
  const body: SubscribeBody = {
    endpoint: json.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    platform: navigator.platform || undefined,
  };
  const { data } = await api<{ subscriptionId: string }>("/v1/push-subscriptions", { method: "POST", body });
  return data.subscriptionId;
}

/** E-21: idempotente (204 aunque ya no exista). */
export async function unsubscribePushSubscription(subscriptionId: string): Promise<void> {
  await api(`/v1/push-subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
}
