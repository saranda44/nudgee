/**
 * Última biblioteca conocida en IndexedDB (NFR-12): para abrir la app sin red y ver lo último
 * que se cargó. Mismo patrón que auth/refresh-store.ts, pero en su propia base — así ninguno de
 * los dos archivos tiene que coordinar versiones de la base del otro.
 */

import type { Item } from "../domain/item.ts";

const DB_NAME = "nudgee-library";
const STORE = "cache";
const KEY = "items";

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

/** La última lista que se cargó con éxito (E-06), o `null` si nunca se guardó/no hay soporte. */
export async function loadCachedItems(): Promise<Item[] | null> {
  try {
    const value = await run<unknown>("readonly", (s) => s.get(KEY));
    return Array.isArray(value) ? (value as Item[]) : null;
  } catch {
    return null; // IndexedDB bloqueado (privado) o sin soporte: simplemente no hay caché
  }
}

export async function saveCachedItems(items: Item[]): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(items, KEY));
  } catch {
    // No es crítico: la próxima carga exitosa lo vuelve a intentar.
  }
}

/** Al cerrar sesión: la siguiente cuenta que entre en este dispositivo no debe heredar la
 *  biblioteca de la anterior si llega a abrir la app sin red antes de su primera carga real. */
export async function clearCachedItems(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // No es crítico: en el peor caso, se ve una biblioteca vieja hasta la próxima carga con red.
  }
}
