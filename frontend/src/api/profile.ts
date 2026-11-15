/** E-03 / E-04: perfil del usuario (Contratos §4). */

import { api } from "./client.ts";

export interface Profile {
  userId: string;
  email: string;
  name: string;
  timezone: string;
  locale: string;
  scheduleState: "NONE" | "ACTIVE";
  subscriptionCount: number;
  createdAt: string;
}

export async function getProfile(signal?: AbortSignal): Promise<Profile> {
  return (await api<Profile>("/v1/me", { signal })).data;
}

/**
 * E-04 silencioso al iniciar (P-02): manda la zona real del navegador. La primera vez crea el
 * schedule de recordatorios (NTF-02); después solo actualiza si el usuario viajó.
 */
export async function syncTimezone(): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await api("/v1/me", { method: "PATCH", body: { timezone } });
}

/** E-04: edición manual desde Cuenta (P-05). */
export async function updateProfile(changes: { name?: string }): Promise<Profile> {
  return (await api<Profile>("/v1/me", { method: "PATCH", body: changes })).data;
}
