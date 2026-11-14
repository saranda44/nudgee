/**
 * Refresh token en IndexedDB (decisión de Fase 8): sobrevive a recargas y cierres del navegador
 * sin vivir en localStorage. El access token nunca se persiste: vive en memoria (session.ts).
 */

const DB_NAME = "nudgee";
const STORE = "auth";
const KEY = "refreshToken";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadRefreshToken(): Promise<string | null> {
  const value = await run<unknown>("readonly", (s) => s.get(KEY));
  return typeof value === "string" ? value : null;
}

export async function saveRefreshToken(token: string): Promise<void> {
  await run("readwrite", (s) => s.put(token, KEY));
}

export async function clearRefreshToken(): Promise<void> {
  await run("readwrite", (s) => s.delete(KEY));
}
