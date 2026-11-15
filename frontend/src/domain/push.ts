/**
 * Ciclo de suscripción push (US-35): pedir permiso, suscribir en el navegador y registrar en
 * el servidor (E-20), o dar de baja (E-21). Compartido por el banner de permisos y Cuenta.
 */

import { registerPushSubscription, unsubscribePushSubscription } from "../api/push.ts";

const SUBSCRIPTION_ID_KEY = "nudgee.pushSubscriptionId";

export function loadSubscriptionId(): string | null {
  try {
    return localStorage.getItem(SUBSCRIPTION_ID_KEY);
  } catch {
    return null;
  }
}

function saveSubscriptionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(SUBSCRIPTION_ID_KEY, id);
    else localStorage.removeItem(SUBSCRIPTION_ID_KEY);
  } catch {
    // localStorage bloqueado (privado/cuota): no es crítico, se vuelve a registrar la próxima vez.
  }
}

export const pushSupported = (): boolean => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** `navigator.serviceWorker.ready` se queda esperando para siempre si nadie llegó a registrar un
 *  service worker (p. ej. el registro de main.tsx seguía en curso o falló en silencio): con
 *  timeout, en vez de un botón pegado sin avisar nada. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("push-sw-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Registrar es idempotente (el navegador reutiliza el registro si ya existe): no hay que
 *  confiar en que el de main.tsx ya haya terminado. */
async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return withTimeout(navigator.serviceWorker.ready, 10_000);
}

/** La VAPID key llega en base64url (E-02); pushManager.subscribe pide un Uint8Array respaldado
 *  por un ArrayBuffer normal (Uint8Array.from da uno "ArrayBufferLike" que TS ya no acepta ahí). */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Pide permiso si hace falta, suscribe en el navegador y registra en el servidor (E-20).
 *  Lanza `Error("push-permission-denied")` si el usuario (o el navegador) lo rechaza. */
export async function subscribeToPush(vapidPublicKey: string): Promise<string> {
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission !== "granted") throw new Error("push-permission-denied");

  const registration = await ensureServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  const subscriptionId = await registerPushSubscription(subscription);
  saveSubscriptionId(subscriptionId);
  return subscriptionId;
}

/** Da de baja en el servidor (E-21) y en el navegador. */
export async function unsubscribeFromPush(): Promise<void> {
  const subscriptionId = loadSubscriptionId();
  if (subscriptionId) await unsubscribePushSubscription(subscriptionId);
  saveSubscriptionId(null);
  if (pushSupported()) {
    const registration = await ensureServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
}

/**
 * El service worker avisa con postMessage cuando le llega un push (ver public/sw.js), para que
 * el contador del bottom nav y P-06 se refresquen solos en vez de solo al recargar la página.
 */
export function onPushReceived(callback: () => void): () => void {
  if (!("serviceWorker" in navigator)) return () => undefined;
  const handler = (event: MessageEvent) => {
    if ((event.data as { type?: string } | undefined)?.type === "NUDGEE_PUSH_RECEIVED") callback();
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
