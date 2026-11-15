/**
 * P-04 Formulario/Edición (US-11–US-14, E-08, E-09). Campos dinámicos por categoría
 * (RF §3.1, backend/schemas/categories.ts). Errores en línea por JSON Pointer (Diseño UX §2);
 * cambiar de categoría borra los campos específicos; "¿Descartar cambios?" al salir sin guardar.
 */

import { ArrowLeft, Info, X, YoutubeLogo } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { getItem, patchItem, restoreItem, runAction, submitForm } from "../api/items.ts";
import {
  ArrayField,
  DateField,
  EntryListEditor,
  NumberField,
  SelectField,
  TextareaField,
  TextField,
  TimeField,
  type EntryFieldDef,
} from "../components/FormFields.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { useToast } from "../components/Toast.tsx";
import { CATEGORIES, type Category, type Item } from "../domain/item.ts";
import { CATEGORY_VIEW } from "../domain/categories.ts";
import { youtubeShort } from "../domain/links.ts";
import { errorMessage, t } from "../i18n/index.ts";
import type { MessageKey } from "../i18n/es-MX.ts";
import { useLibrary } from "../state/library.tsx";
import { NotFoundPage } from "./placeholders.tsx";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

interface EntryField {
  id: string;
  text: string;
}

interface FormState {
  category: Category;
  title: string;
  summary: string;
  details: Record<string, unknown>;
}

/**
 * Lee cualquiera de las dos formas que puede traer un arreglo: marcables ya guardados
 * (`{id, text}`, backend/schemas/common.ts → CheckItemSchema) o pasos en texto plano
 * (`string`, → StepsField). Siempre regresa `{id, text}` para editar; el id de un paso es
 * solo una key de React, nunca se manda al servidor (ver `toBody`).
 */
function toEntries(value: unknown): EntryField[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    if (typeof entry === "string") return { id: `tmp${i}`, text: entry };
    const obj = entry as { id?: unknown; text?: unknown } | null;
    return { id: typeof obj?.id === "string" ? obj.id : `tmp${i}`, text: typeof obj?.text === "string" ? obj.text : "" };
  });
}

/** Ids que empiezan con "tmp" son nuestros, nunca del servidor (nota de common.ts: "never invent one"). */
const isOwnId = (id: string) => id.startsWith("tmp");

/** ingredients/exercises/materials: de vuelta a `{id?, text}[]`, vacíos fuera. */
function fromChecklistEntries(entries: EntryField[]): Array<{ id?: string; text: string }> {
  return entries
    .map((e) => ({ id: e.id, text: e.text.trim() }))
    .filter((e) => e.text.length > 0)
    .map((e) => (isOwnId(e.id) ? { text: e.text } : e));
}

/** steps: de vuelta a `string[]` (StepsField no tiene id), vacíos fuera. */
function fromStepEntries(entries: EntryField[]): string[] {
  return entries.map((e) => e.text.trim()).filter((text) => text.length > 0);
}

const CHECKLIST_KEYS = new Set(["ingredients", "exercises", "materials"]);
const STEP_KEYS = new Set(["steps"]);

/** `details.entries[]` (MOVIE_SERIES, PLACE, BOOK, MUSIC, PODCAST → ListCategoryDetails): un
 *  objeto con varios campos de texto por entrada. Se edita como string siempre; `year` se
 *  vuelve número solo al armar el body (ver ENTRY_FIELDS + fromEntryObjects). */
interface EntryObject {
  id: string;
  [key: string]: string;
}

function toEntryObjects(value: unknown): EntryObject[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    const obj = (entry ?? {}) as Record<string, unknown>;
    const out: EntryObject = { id: typeof obj.id === "string" ? obj.id : `tmp${i}` };
    for (const [k, v] of Object.entries(obj)) {
      if (k === "id") continue;
      if (typeof v === "string" || typeof v === "number") out[k] = String(v);
    }
    return out;
  });
}

function fromEntryObjects(entries: EntryObject[], fields: EntryFieldDef[]): Array<Record<string, unknown>> {
  const numericKeys = new Set(fields.filter((f) => f.type === "number").map((f) => f.key));
  return entries
    .map(({ id, ...rest }) => {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        const trimmed = v.trim();
        if (trimmed) cleaned[k] = numericKeys.has(k) ? Number(trimmed) : trimmed;
      }
      return { id, cleaned };
    })
    .filter(({ cleaned }) => Object.keys(cleaned).length > 0)
    .map(({ id, cleaned }) => (isOwnId(id) ? cleaned : { id, ...cleaned }));
}

/** Campos por entrada, categoría por categoría (RF §3.1, backend/schemas/categories.ts). */
const ENTRY_FIELDS: Partial<Record<Category, EntryFieldDef[]>> = {
  MOVIE_SERIES: [
    { key: "title", label: t("edit.movieTitle"), type: "text" },
    {
      key: "mediaType",
      label: t("edit.mediaType"),
      type: "select",
      options: [
        { value: "MOVIE", label: t("edit.mediaType.MOVIE") },
        { value: "SERIES", label: t("edit.mediaType.SERIES") },
      ],
    },
    { key: "year", label: t("edit.year"), type: "number" },
  ],
  PLACE: [
    { key: "name", label: t("edit.placeName"), type: "text" },
    { key: "cityOrAddress", label: t("edit.cityOrAddress"), type: "text" },
  ],
  BOOK: [
    { key: "title", label: t("edit.bookTitle"), type: "text" },
    { key: "author", label: t("edit.author"), type: "text" },
  ],
  MUSIC: [
    { key: "name", label: t("edit.musicName"), type: "text" },
    {
      key: "musicType",
      label: t("edit.musicType"),
      type: "select",
      options: [
        { value: "SONG", label: t("edit.musicType.SONG") },
        { value: "ALBUM", label: t("edit.musicType.ALBUM") },
        { value: "ARTIST", label: t("edit.musicType.ARTIST") },
      ],
    },
    { key: "artist", label: t("edit.artist"), type: "text" },
    { key: "genre", label: t("edit.genre"), type: "text" },
  ],
  PODCAST: [
    { key: "showName", label: t("edit.showName"), type: "text" },
    { key: "episode", label: t("edit.episode"), type: "text" },
  ],
};

/** Nombre de una sola entrada ("Lugar 1") y texto del botón de agregar, por categoría. */
const ENTRY_NOUN: Partial<Record<Category, MessageKey>> = {
  MOVIE_SERIES: "edit.entryNoun.MOVIE_SERIES",
  PLACE: "edit.entryNoun.PLACE",
  BOOK: "edit.entryNoun.BOOK",
  MUSIC: "edit.entryNoun.MUSIC",
  PODCAST: "edit.entryNoun.PODCAST",
};

const ENTRY_ADD_LABEL: Partial<Record<Category, MessageKey>> = {
  MOVIE_SERIES: "edit.addEntry.MOVIE_SERIES",
  PLACE: "edit.addEntry.PLACE",
  BOOK: "edit.addEntry.BOOK",
  MUSIC: "edit.addEntry.MUSIC",
  PODCAST: "edit.addEntry.PODCAST",
};

function fromItem(item: Item): FormState {
  return {
    category: item.category ?? "OTHER",
    title: item.title ?? "",
    summary: item.summary ?? "",
    details: item.details ?? {},
  };
}

/** Body enviado a E-08/E-09: `details` convierte cada arreglo editable a la forma que espera el schema. */
function toBody(form: FormState): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(form.details)) {
    if (CHECKLIST_KEYS.has(key)) {
      const entries = fromChecklistEntries(toEntries(value));
      if (entries.length > 0) details[key] = entries;
    } else if (STEP_KEYS.has(key)) {
      const steps = fromStepEntries(toEntries(value));
      if (steps.length > 0) details[key] = steps;
    } else if (key === "entries") {
      const entries = fromEntryObjects(toEntryObjects(value), ENTRY_FIELDS[form.category] ?? []);
      if (entries.length > 0) details[key] = entries;
    } else if (value !== undefined && value !== "") {
      details[key] = value;
    }
  }
  return { category: form.category, title: form.title, summary: form.summary || undefined, details };
}

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_VIEW[c].label) }));

export function ItemEditPage() {
  const { videoId = "" } = useParams();
  const navigate = useNavigate();
  const library = useLibrary();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  const [item, setItem] = useState<Item | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!VIDEO_ID.test(videoId)) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const cached = library.get(videoId);
        const loaded = cached && cached.status !== "PROCESSING" ? cached : await getItem(videoId, ctrl.signal);
        if (!["PENDING", "DORMANT", "NEEDS_INPUT"].includes(loaded.status)) {
          navigate(`/items/${videoId}`, { replace: true });
          return;
        }
        library.upsert(loaded);
        setItem(loaded);
        const state = fromItem(loaded);
        setForm(state);
        setInitial(state);
        setLoad("ready");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        if (e instanceof ApiError && e.status === 404) {
          setLoad("notfound");
        } else {
          setLoadError(errorMessage(e));
          setLoad("error");
        }
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const hasChanges = form && initial && JSON.stringify(form) !== JSON.stringify(initial);

  const clearError = (pointer: string) =>
    setErrors((prev) => {
      if (!prev.has(pointer)) return prev;
      const next = new Map(prev);
      next.delete(pointer);
      return next;
    });

  const setDetail = (key: string, value: unknown) => {
    setForm((prev) => (prev ? { ...prev, details: { ...prev.details, [key]: value } } : prev));
    clearError(`/details/${key}`);
  };

  const onCategoryChange = (category: Category) => {
    setForm((prev) => (prev ? { ...prev, category, details: {} } : prev));
    setErrors(new Map());
  };

  const addEntry = (key: string) => {
    const current = toEntries(form?.details[key]);
    setDetail(key, [...current, { id: `tmp${Date.now()}`, text: "" }]);
  };
  const removeEntry = (key: string, id: string) => setDetail(key, toEntries(form?.details[key]).filter((e) => e.id !== id));
  const changeEntry = (key: string, id: string, text: string) =>
    setDetail(key, toEntries(form?.details[key]).map((e) => (e.id === id ? { ...e, text } : e)));

  const addEntryRow = () => setDetail("entries", [...toEntryObjects(form?.details.entries), { id: `tmp${Date.now()}` }]);
  const removeEntryRow = (index: number) => setDetail("entries", toEntryObjects(form?.details.entries).filter((_, i) => i !== index));
  const changeEntryRow = (index: number, key: string, value: string) =>
    setDetail("entries", toEntryObjects(form?.details.entries).map((e, i) => (i === index ? { ...e, [key]: value } : e)));

  /** Un error anidado (`/details/entries/0/title`) no se liga a un campo exacto aquí: se muestra
   *  completo bajo la lista, mejor que perderlo (Diseño UX §2: todo error visible en línea). */
  const entriesError = [...errors.entries()].find(([pointer]) => pointer.startsWith("/details/entries"))?.[1];

  const scrollToFirstError = useCallback((pointers: string[]) => {
    const first = pointers[0];
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-pointer="${first}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  }, []);

  const applyFieldErrors = (e: unknown): boolean => {
    if (!(e instanceof ApiError) || !e.fieldErrors?.length) return false;
    const next = new Map<string, string>();
    for (const fe of e.fieldErrors) next.set(fe.pointer, fe.message);
    setErrors(next);
    scrollToFirstError([...next.keys()]);
    return true;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!item || !form || saving) return;
    setSaving(true);
    setErrors(new Map());
    try {
      const needsInput = item.status === "NEEDS_INPUT";
      const updated = needsInput ? await submitForm(videoId, toBody(form)) : await patchItem(videoId, toBody(form), item.version);
      library.upsert(updated);
      toast({ message: t("edit.saved") });
      // navigate(-1), no push: solo se entra aquí desde la tarjeta (ItemPage) con un <Link>, así
      // que volver un paso aterriza ahí mismo, ya con los datos frescos (library es reactiva);
      // empujar una ruta nueva dejaría este formulario atrapado en el historial (haría falta
      // tocar "atrás" dos veces para salir de la tarjeta).
      navigate(-1);
    } catch (e) {
      if (!applyFieldErrors(e)) {
        if (e instanceof ApiError && (e.code === "VERSION_MISMATCH" || e.status === 404)) {
          toast({ message: errorMessage(e) });
          navigate(-1);
        } else {
          toast({ message: errorMessage(e) });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => (hasChanges ? setConfirmDiscard(true) : navigate(-1));

  /** E-14 desde el formulario de NEEDS_INPUT: igual que en la tarjeta (sin diálogo, con deshacer),
   *  pero aquí sí nos salimos — el formulario ya no aplica una vez descartado. */
  const discardVideo = async () => {
    if (!item || discarding) return;
    setDiscarding(true);
    try {
      const updated = await runAction(videoId, "discard", item.version);
      library.upsert(updated);
      toast({
        message: t("item.discardedToast"),
        action: {
          label: t("common.undo"),
          onClick: () => {
            void restoreItem(videoId, updated.version)
              .then((u) => library.upsert(u))
              .catch((e) => toast({ message: errorMessage(e) }));
          },
        },
      });
      navigate(-1);
    } catch (e) {
      toast({ message: errorMessage(e) });
    } finally {
      setDiscarding(false);
    }
  };

  if (!VIDEO_ID.test(videoId)) return <NotFoundPage />;

  const header = (
    <div className="app-header">
      <button type="button" className="app-iconbtn" onClick={goBack} aria-label={t("common.back")}>
        <ArrowLeft size={22} weight="bold" aria-hidden />
      </button>
    </div>
  );

  if (load === "notfound") {
    return (
      <main className="app-page">
        {header}
        <div className="app-empty">
          <p className="t-body">{t("error.ITEM_NOT_FOUND")}</p>
        </div>
      </main>
    );
  }

  if (load === "error") {
    return (
      <main className="app-page">
        {header}
        <div className="app-empty" role="alert">
          <p className="t-body">{loadError}</p>
        </div>
      </main>
    );
  }

  if (load === "loading" || !item || !form) {
    return (
      <main className="app-page" aria-busy="true">
        {header}
        <div className="ng-card is-processing app-hero-card">
          <div className="ng-skel app-skel-90" />
          <div className="ng-skel app-skel-55" />
        </div>
      </main>
    );
  }

  const needsInput = item.status === "NEEDS_INPUT";

  return (
    <main className="app-page">
      {needsInput ? (
        <div className="app-header app-header--sheet">
          <button type="button" className="app-iconbtn" onClick={goBack} aria-label={t("common.close")}>
            <X size={22} weight="bold" aria-hidden />
          </button>
          <h1 className="app-header__title">{t("edit.needsInputHeader")}</h1>
          <span className="app-iconbtn" aria-hidden />
        </div>
      ) : (
        header
      )}

      {needsInput && (
        <>
          <div className="app-info-note" role="note">
            <Info size={20} weight="bold" aria-hidden />
            <p className="t-caption">{t("edit.needsInputBanner")}</p>
          </div>
          <a className="app-info-note__link" href={youtubeShort(item.videoId)} target="_blank" rel="noopener noreferrer">
            <YoutubeLogo size={16} weight="bold" aria-hidden />
            {t("edit.needsInputYoutubeLink")}
          </a>
        </>
      )}

      {!needsInput && <h1 className="t-display">{item.title || t("item.untitled")}</h1>}

      <form ref={formRef} className="ng-col" onSubmit={onSubmit} noValidate>
        <SelectField
          label={t("edit.category")}
          placeholder={t("edit.categoryPlaceholder")}
          value={form.category}
          onChange={(value) => onCategoryChange(value as Category)}
          options={CATEGORY_OPTIONS}
        />

        <TextField
          label={t("edit.title")}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          data-pointer="/title"
          error={errors.get("/title")}
          maxLength={200}
        />

        <TextareaField
          label={t("edit.summary")}
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
          data-pointer="/summary"
          error={errors.get("/summary")}
          maxLength={500}
        />

        {form.category === "RECIPE" && (
          <>
            <ArrayField
              label={t("details.ingredients")}
              items={toEntries(form.details.ingredients)}
              onAdd={() => addEntry("ingredients")}
              onRemove={(id) => removeEntry("ingredients", id)}
              onChange={(id, text) => changeEntry("ingredients", id, text)}
              placeholder={t("edit.ingredientPlaceholder")}
              addLabel={t("edit.addItem")}
              removeLabel={t("edit.removeItem")}
              error={errors.get("/details/ingredients")}
            />
            <ArrayField
              label={t("details.steps")}
              items={toEntries(form.details.steps)}
              onAdd={() => addEntry("steps")}
              onRemove={(id) => removeEntry("steps", id)}
              onChange={(id, text) => changeEntry("steps", id, text)}
              placeholder={t("edit.stepPlaceholder")}
              addLabel={t("edit.addItem")}
              removeLabel={t("edit.removeItem")}
              error={errors.get("/details/steps")}
            />
            <NumberField
              label={t("edit.prepTime")}
              value={(form.details.prepTime as number | undefined) ?? ""}
              onChange={(e) => setDetail("prepTime", e.target.value ? Number(e.target.value) : undefined)}
              min={0}
              data-pointer="/details/prepTime"
              error={errors.get("/details/prepTime")}
            />
          </>
        )}

        {form.category === "ROUTINE" && (
          <>
            <ArrayField
              label={t("details.exercises")}
              items={toEntries(form.details.exercises)}
              onAdd={() => addEntry("exercises")}
              onRemove={(id) => removeEntry("exercises", id)}
              onChange={(id, text) => changeEntry("exercises", id, text)}
              placeholder={t("edit.exercisePlaceholder")}
              addLabel={t("edit.addItem")}
              removeLabel={t("edit.removeItem")}
              error={errors.get("/details/exercises")}
            />
            <NumberField
              label={t("edit.durationMin")}
              value={(form.details.durationMin as number | undefined) ?? ""}
              onChange={(e) => setDetail("durationMin", e.target.value ? Number(e.target.value) : undefined)}
              min={0}
              data-pointer="/details/durationMin"
              error={errors.get("/details/durationMin")}
            />
          </>
        )}

        {form.category === "TUTORIAL" && (
          <>
            <ArrayField
              label={t("details.materials")}
              items={toEntries(form.details.materials)}
              onAdd={() => addEntry("materials")}
              onRemove={(id) => removeEntry("materials", id)}
              onChange={(id, text) => changeEntry("materials", id, text)}
              placeholder={t("edit.materialPlaceholder")}
              addLabel={t("edit.addItem")}
              removeLabel={t("edit.removeItem")}
              error={errors.get("/details/materials")}
            />
            <ArrayField
              label={t("details.steps")}
              items={toEntries(form.details.steps)}
              onAdd={() => addEntry("steps")}
              onRemove={(id) => removeEntry("steps", id)}
              onChange={(id, text) => changeEntry("steps", id, text)}
              placeholder={t("edit.stepPlaceholder")}
              addLabel={t("edit.addItem")}
              removeLabel={t("edit.removeItem")}
              error={errors.get("/details/steps")}
            />
          </>
        )}

        {form.category === "EVENT" && (
          <>
            <TextField
              label={t("edit.eventName")}
              value={(form.details.name as string | undefined) ?? ""}
              onChange={(e) => setDetail("name", e.target.value)}
              data-pointer="/details/name"
              error={errors.get("/details/name")}
            />
            <DateField
              label={t("edit.eventDate")}
              value={(form.details.eventDate as string | undefined) ?? ""}
              onChange={(e) => setDetail("eventDate", e.target.value || undefined)}
              data-pointer="/details/eventDate"
              error={errors.get("/details/eventDate")}
            />
            <TimeField
              label={t("edit.eventTime")}
              value={(form.details.eventTime as string | undefined) ?? ""}
              onChange={(e) => setDetail("eventTime", e.target.value || undefined)}
              data-pointer="/details/eventTime"
              error={errors.get("/details/eventTime")}
            />
            <TextField
              label={t("edit.eventAddress")}
              value={(form.details.cityOrAddress as string | undefined) ?? ""}
              onChange={(e) => setDetail("cityOrAddress", e.target.value || undefined)}
              data-pointer="/details/cityOrAddress"
              error={errors.get("/details/cityOrAddress")}
            />
          </>
        )}

        {ENTRY_FIELDS[form.category] && (
          <EntryListEditor
            entries={toEntryObjects(form.details.entries)}
            fields={ENTRY_FIELDS[form.category]!}
            onAdd={addEntryRow}
            onRemove={removeEntryRow}
            onChange={changeEntryRow}
            error={entriesError}
            addLabel={t(ENTRY_ADD_LABEL[form.category]!)}
            removeLabel={t("edit.removeItem")}
            entryLabel={(i) => `${t(ENTRY_NOUN[form.category]!)} ${i + 1}`}
          />
        )}

        <button type="submit" className="ng-btn ng-btn--primary ng-btn--block" aria-busy={saving} disabled={saving}>
          {t("edit.save")}
        </button>
      </form>

      {needsInput && (
        <button type="button" className="app-discard-link" onClick={() => void discardVideo()} disabled={discarding} aria-busy={discarding}>
          {t("edit.discardVideo")}
        </button>
      )}

      <Dialog open={confirmDiscard} title={t("edit.discardTitle")} onClose={() => setConfirmDiscard(false)}>
        <div className="ng-col">
          <p className="t-body">{t("edit.discardBody")}</p>
          <div className="app-sheet-actions">
            <button type="button" className="ng-btn ng-btn--ghost" onClick={() => setConfirmDiscard(false)}>
              {t("edit.keepEditing")}
            </button>
            <button type="button" className="ng-btn ng-btn--danger" onClick={() => navigate(-1)}>
              {t("edit.discardChanges")}
            </button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
