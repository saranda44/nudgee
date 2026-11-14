/**
 * Biblioteca en memoria compartida por P-02, P-07 y P-03: se carga una vez con E-06 y se
 * mantiene al día con las respuestas de cada acción (upsert) y con el polling de PROCESSING
 * (US-09): cada `pollingIntervalMs` hasta que no quede ninguno o pase `pollingMaxDurationMs`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getClientConfig, listAllItems, pollItems } from "../api/items.ts";
import { useToast } from "../components/Toast.tsx";
import { CATEGORY_VIEW } from "../domain/categories.ts";
import type { ClientConfig, Item } from "../domain/item.ts";
import { errorMessage, t } from "../i18n/index.ts";

interface LibraryState {
  items: Item[];
  status: "loading" | "ready" | "error";
  error: string | null;
  config: ClientConfig | null;
  reload: () => void;
  /** Inserta o reemplaza con la versión que devolvió la API. */
  upsert: (item: Item) => void;
  /** Mezcla campos sobre la versión más reciente en memoria (sin carreras entre clics). */
  patch: (videoId: string, change: (current: Item) => Partial<Item>) => void;
  remove: (videoId: string) => void;
  get: (videoId: string) => Item | undefined;
}

const LibraryContext = createContext<LibraryState | null>(null);

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary fuera de LibraryProvider");
  return ctx;
}

const DEFAULT_POLLING = { pollingIntervalMs: 4000, pollingMaxDurationMs: 120_000 };

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [byId, setById] = useState<Map<string, Item>>(new Map());
  const [status, setStatus] = useState<LibraryState["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  /** Hasta cuándo seguir haciendo polling; un guardado nuevo lo extiende. */
  const pollUntil = useRef(0);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const ctrl = new AbortController();
    getClientConfig().then(setConfig, () => undefined);
    listAllItems(ctrl.signal).then(
      (items) => {
        setById(new Map(items.map((i) => [i.videoId, i])));
        setStatus("ready");
        setError(null);
        pollUntil.current = Date.now() + DEFAULT_POLLING.pollingMaxDurationMs;
      },
      (e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setError(errorMessage(e));
        setStatus("error");
      },
    );
    return () => ctrl.abort();
  }, [loadKey]);

  const upsert = useCallback(
    (item: Item) => {
      setById((prev) => new Map(prev).set(item.videoId, item));
      if (item.status === "PROCESSING") {
        pollUntil.current = Date.now() + (config?.pollingMaxDurationMs ?? DEFAULT_POLLING.pollingMaxDurationMs);
      }
    },
    [config],
  );

  const patch = useCallback((videoId: string, change: (current: Item) => Partial<Item>) => {
    setById((prev) => {
      const current = prev.get(videoId);
      return current ? new Map(prev).set(videoId, { ...current, ...change(current) }) : prev;
    });
  }, []);

  const remove = useCallback((videoId: string) => {
    setById((prev) => {
      const next = new Map(prev);
      next.delete(videoId);
      return next;
    });
  }, []);

  /** ids en PROCESSING como cadena estable: el efecto solo cambia si cambia el conjunto. */
  const processingKey = useMemo(
    () => [...byId.values()].filter((i) => i.status === "PROCESSING").map((i) => i.videoId).sort().join(","),
    [byId],
  );

  /** Se incrementa en cada ciclo de polling (o al volver a la pestaña) para re-armar el timer. */
  const [pollTick, setPollTick] = useState(0);
  const byIdRef = useRef(byId);
  useEffect(() => {
    byIdRef.current = byId;
  }, [byId]);

  useEffect(() => {
    const onVisible = () => !document.hidden && setPollTick((n) => n + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (processingKey === "") return;
    const ids = processingKey.split(",");
    const interval = config?.pollingIntervalMs ?? DEFAULT_POLLING.pollingIntervalMs;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      // Pestaña oculta o plazo vencido: se detiene; visibilitychange o un guardado nuevo lo reanudan.
      if (Date.now() > pollUntil.current || document.hidden) return;
      try {
        const fresh = await pollItems(ids, ctrl.signal);
        for (const item of fresh) {
          const before = byIdRef.current.get(item.videoId);
          if (before?.status === "PROCESSING" && item.status === "PENDING" && item.category) {
            toast({
              message: t("library.ready", { title: item.title ?? "", folder: t(CATEGORY_VIEW[item.category].label) }),
              action: { label: t("common.view"), onClick: () => navigate(`/items/${item.videoId}`) },
            });
          }
        }
        setById((prev) => {
          const next = new Map(prev);
          for (const item of fresh) next.set(item.videoId, item);
          return next;
        });
      } catch {
        // Error transitorio (red, 5xx): se reintenta en el siguiente ciclo.
      }
      if (!ctrl.signal.aborted) setPollTick((n) => n + 1);
    }, interval);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [processingKey, pollTick, config, toast, navigate]);

  const value = useMemo<LibraryState>(
    () => ({
      items: [...byId.values()],
      status,
      error,
      config,
      reload: () => {
        setStatus("loading");
        setLoadKey((k) => k + 1);
      },
      upsert,
      patch,
      remove,
      get: (videoId) => byId.get(videoId),
    }),
    [byId, status, error, config, upsert, patch, remove],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
