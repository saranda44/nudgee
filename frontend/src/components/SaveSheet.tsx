/**
 * O-05 Guardar (US-04–US-07, UX-03): pegar y tocar "Guardar"; el botón nunca se deshabilita y
 * los errores van en línea bajo el campo (Diseño UX §2). Se abre desde el FAB o desde el
 * estado vacío de P-02, con el campo enfocado.
 */

import { WarningCircle } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client.ts";
import { getItem, restoreItem, saveLink } from "../api/items.ts";
import type { ItemStatus } from "../domain/item.ts";
import { errorMessage, t } from "../i18n/index.ts";
import { useLibrary } from "../state/library.tsx";
import { useToast } from "./Toast.tsx";

const SaveSheetContext = createContext<() => void>(() => undefined);

export function useOpenSaveSheet() {
  return useContext(SaveSheetContext);
}

interface InlineError {
  message: string;
  /** 409 DUPLICATE_ITEM: "Ver" o "Restaurar" si está descartado. */
  duplicate?: { videoId: string; status: ItemStatus };
}

export function SaveSheetProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<InlineError | null>(null);
  const titleId = useId();
  const helpId = useId();
  const { upsert } = useLibrary();
  const toast = useToast();
  const navigate = useNavigate();

  const open = useCallback(() => {
    setUrl("");
    setError(null);
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  // Tocar el velo (fuera del sheet) cierra; Esc lo cierra el <dialog> nativo.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClick = (e: MouseEvent) => e.target === dialog && dialog.close();
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, []);

  const succeed = (message: string) => {
    close();
    toast({ message });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = url.trim();
    if (!value) {
      setError({ message: t("error.INVALID_URL") });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      upsert(await saveLink(value));
      succeed(t("save.saved"));
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_ITEM") {
        const existing = err.problem.existing as { videoId: string; status: ItemStatus } | undefined;
        if (existing?.status === "PROCESSING") {
          // Reintento de red del mismo POST (Contratos E-05, regla 4): cuenta como éxito.
          getItem(existing.videoId).then(upsert, () => undefined);
          succeed(t("save.saved"));
        } else {
          setError({ message: t("error.DUPLICATE_ITEM"), duplicate: existing });
        }
      } else if (err instanceof ApiError && (err.code === "INVALID_URL" || err.code === "VALIDATION_ERROR")) {
        setError({ message: t("error.INVALID_URL") });
      } else {
        setError({ message: errorMessage(err) });
      }
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const view = (videoId: string) => {
    close();
    navigate(`/items/${videoId}`);
  };

  const restore = async (videoId: string) => {
    setBusy(true);
    try {
      const current = await getItem(videoId);
      upsert(await restoreItem(videoId, current.version));
      succeed(t("save.restored"));
    } catch (err) {
      setError({ message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SaveSheetContext.Provider value={open}>
      {children}
      <dialog ref={dialogRef} className="app-sheet-dialog" aria-labelledby={titleId}>
        <form className="ng-sheet" onSubmit={onSubmit} noValidate>
          <div className="ng-sheet__handle" aria-hidden />
          <h2 className="ng-sheet__title" id={titleId}>
            {t("save.title")}
          </h2>
          <label className={error ? "ng-field is-invalid" : "ng-field"}>
            <span className="ng-label">{t("save.label")}</span>
            <input
              ref={inputRef}
              className="ng-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://youtube.com/shorts/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={helpId}
            />
            <span className="ng-help" id={helpId} role={error ? "alert" : undefined}>
              {error && <WarningCircle size={16} weight="bold" aria-hidden />}
              {error ? error.message : t("save.help")}
            </span>
          </label>
          {error?.duplicate && (
            <div className="app-sheet-actions">
              {error.duplicate.status === "DISCARDED" ? (
                <button type="button" className="ng-btn ng-btn--ghost" onClick={() => restore(error.duplicate!.videoId)}>
                  {t("save.restore")}
                </button>
              ) : (
                <button type="button" className="ng-btn ng-btn--ghost" onClick={() => view(error.duplicate!.videoId)}>
                  {t("common.view")}
                </button>
              )}
            </div>
          )}
          <button type="submit" className="ng-btn ng-btn--primary ng-btn--block" aria-busy={busy}>
            {busy ? t("save.saving") : t("save.cta")}
          </button>
        </form>
      </dialog>
    </SaveSheetContext.Provider>
  );
}
