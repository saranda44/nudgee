/** Campos de formulario de P-04, en el mismo patrón que SaveSheet (O-05): label envolvente,
 *  ng-field/ng-label/ng-input/ng-help, error en línea con ícono (Diseño UX §2). */

import { CaretDown, Plus, TrashSimple, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

interface FieldProps {
  label: string;
  error?: string;
  help?: string;
}

/** Separa el sufijo "(opcional)"/"(algo)" de una etiqueta para pintarlo más tenue (P-04). */
const OPTIONAL_SUFFIX = /^(.+?)\s*(\([^)]+\))$/;
function FieldLabel({ label }: { label: string }) {
  const m = OPTIONAL_SUFFIX.exec(label);
  if (!m) return <span className="ng-label app-field-label">{label}</span>;
  return (
    <span className="ng-label app-field-label">
      {m[1]} <span className="app-field-label__hint">{m[2]}</span>
    </span>
  );
}

function FieldWrapper({
  label,
  error,
  help,
  helpId,
  children,
}: {
  label: string;
  error?: string;
  help?: string;
  helpId: string;
  children: (describedBy: string | undefined) => React.ReactNode;
}) {
  const showHelp = Boolean(error || help);
  return (
    <label className={error ? "ng-field is-invalid" : "ng-field"}>
      <FieldLabel label={label} />
      {children(showHelp ? helpId : undefined)}
      {showHelp && (
        <span className="ng-help" id={helpId} role={error ? "alert" : undefined}>
          {error && <WarningCircle size={16} weight="bold" aria-hidden />}
          {error ?? help}
        </span>
      )}
    </label>
  );
}

export function TextField({ label, error, help, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const helpId = useId();
  return (
    <FieldWrapper label={label} error={error} help={help} helpId={helpId}>
      {(describedBy) => (
        <input className="ng-input app-field-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldWrapper>
  );
}

/** Resumen y textos largos: la misma caja que TextField pero con varias líneas. */
export function TextareaField({ label, error, help, ...props }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const helpId = useId();
  return (
    <FieldWrapper label={label} error={error} help={help} helpId={helpId}>
      {(describedBy) => (
        <textarea
          className="ng-input app-field-input app-field-textarea"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          rows={3}
          {...props}
        />
      )}
    </FieldWrapper>
  );
}

export function NumberField({ label, error, help, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const helpId = useId();
  return (
    <FieldWrapper label={label} error={error} help={help} helpId={helpId}>
      {(describedBy) => (
        <input
          type="number"
          inputMode="numeric"
          className="ng-input app-field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
      )}
    </FieldWrapper>
  );
}

export function DateField({ label, error, help, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const helpId = useId();
  return (
    <FieldWrapper label={label} error={error} help={help} helpId={helpId}>
      {(describedBy) => (
        <input type="date" className="ng-input app-field-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldWrapper>
  );
}

export function TimeField({ label, error, help, ...props }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const helpId = useId();
  return (
    <FieldWrapper label={label} error={error} help={help} helpId={helpId}>
      {(describedBy) => (
        <input type="time" className="ng-input app-field-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldWrapper>
  );
}

/**
 * Dropdown propio (no <select> nativo): el navegador no deja estilizar el panel de opciones
 * de un <select> (ni colores, ni padding, ni radios), así que el panel abierto siempre se ve
 * con el estilo del sistema operativo. Este combobox sigue el patrón ARIA listbox: botón con
 * aria-expanded/aria-activedescendant, panel role="listbox" con option role="option".
 */
export function SelectField({
  label,
  error,
  help,
  options,
  placeholder,
  value,
  onChange,
  disabled,
}: FieldProps & {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const helpId = useId();
  const buttonId = useId();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const items = placeholder ? [{ value: "", label: placeholder }, ...options] : options;
  const selectedIndex = Math.max(0, items.findIndex((o) => o.value === value));
  const selected = items[selectedIndex];
  const firstSelectable = placeholder ? 1 : 0; // la opción placeholder (índice 0) está deshabilitada

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const openList = () => {
    setHighlight(Math.max(selectedIndex, firstSelectable));
    setOpen(true);
  };

  const toggle = () => (open ? setOpen(false) : openList());

  const commit = (index: number) => {
    const opt = items[index];
    if (!opt || opt.value === "") return; // opción placeholder: deshabilitada, no seleccionable
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open) setHighlight((h) => Math.min(items.length - 1, Math.max(h + 1, firstSelectable)));
        else openList();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) setHighlight((h) => Math.max(firstSelectable, h - 1));
        else openList();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) commit(highlight);
        else openList();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <FieldWrapper label={label} error={error} help={help} helpId={helpId}>
      {(describedBy) => (
        <div className="app-combobox" ref={rootRef}>
          <button
            type="button"
            id={buttonId}
            className="ng-input app-field-input app-combobox__trigger"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onClick={toggle}
            onKeyDown={onKeyDown}
          >
            <span className={selected?.value ? undefined : "app-combobox__placeholder"}>{selected?.label ?? placeholder}</span>
            <CaretDown size={18} weight="bold" aria-hidden />
          </button>
          {open && (
            <ul className="app-combobox__list" role="listbox" id={listId} aria-labelledby={buttonId}>
              {items.map((opt, i) => {
                const isPlaceholder = opt.value === "";
                return (
                  <li
                    key={opt.value || "placeholder"}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === selectedIndex}
                    aria-disabled={isPlaceholder || undefined}
                    className={[i === highlight && "is-highlighted", isPlaceholder && "is-disabled"].filter(Boolean).join(" ") || undefined}
                    onMouseEnter={() => !isPlaceholder && setHighlight(i)}
                    onClick={() => commit(i)}
                  >
                    {opt.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </FieldWrapper>
  );
}

interface ArrayItem {
  id: string;
  text: string;
}

/** Lista editable (ingredientes, pasos, materiales…): una fila ng-input + eliminar por entrada. */
export function ArrayField({
  label,
  items,
  onAdd,
  onRemove,
  onChange,
  error,
  placeholder,
  addLabel,
  removeLabel,
}: {
  label: string;
  items: ArrayItem[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, text: string) => void;
  error?: string;
  placeholder?: string;
  addLabel: string;
  removeLabel: string;
}) {
  const helpId = useId();
  return (
    <div className={error ? "ng-field is-invalid" : "ng-field"}>
      <FieldLabel label={label} />
      <div className="ng-col">
        {items.map((item, index) => (
          <div className="app-field-row" key={item.id}>
            <input
              type="text"
              className="ng-input app-field-input"
              value={item.text}
              onChange={(e) => onChange(item.id, e.target.value)}
              placeholder={placeholder}
              aria-label={`${label} ${index + 1}`}
            />
            <button type="button" onClick={() => onRemove(item.id)} className="app-iconbtn" aria-label={removeLabel}>
              <TrashSimple size={20} weight="bold" aria-hidden />
            </button>
          </div>
        ))}
        <button type="button" className="app-btn-add" onClick={onAdd}>
          <Plus size={18} weight="bold" aria-hidden />
          {addLabel}
        </button>
      </div>
      {error && (
        <span className="ng-help" id={helpId} role="alert">
          <WarningCircle size={16} weight="bold" aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

export interface EntryFieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: Array<{ value: string; label: string }>;
}

/**
 * Entrada con varios campos (película, lugar, canción…): una tarjeta por entrada (RF §3.1,
 * ListCategoryDetails). Sin label propio: el badge de cada tarjeta ("Lugar 1") ya dice de qué
 * lista se trata, repetirlo arriba era redundante.
 */
export function EntryListEditor({
  entries,
  fields,
  onAdd,
  onRemove,
  onChange,
  error,
  addLabel,
  removeLabel,
  entryLabel,
}: {
  entries: Array<Record<string, string>>;
  fields: EntryFieldDef[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
  error?: string;
  addLabel: string;
  removeLabel: string;
  entryLabel: (index: number) => string;
}) {
  return (
    <div className={error ? "ng-field is-invalid" : "ng-field"}>
      <div className="ng-col">
        {entries.map((entry, index) => (
          <div className="app-entry-card" key={index}>
            <div className="app-entry-card__header">
              <span className="app-entry-card__index">{entryLabel(index)}</span>
              <button type="button" className="app-iconbtn" onClick={() => onRemove(index)} aria-label={removeLabel}>
                <TrashSimple size={20} weight="bold" aria-hidden />
              </button>
            </div>
            {fields.map((f) => {
              if (f.type === "select") {
                return (
                  <SelectField
                    key={f.key}
                    label={f.label}
                    value={entry[f.key] ?? ""}
                    onChange={(v) => onChange(index, f.key, v)}
                    options={f.options ?? []}
                  />
                );
              }
              if (f.type === "number") {
                return (
                  <NumberField
                    key={f.key}
                    label={f.label}
                    value={entry[f.key] ?? ""}
                    onChange={(e) => onChange(index, f.key, e.target.value)}
                  />
                );
              }
              return (
                <TextField key={f.key} label={f.label} value={entry[f.key] ?? ""} onChange={(e) => onChange(index, f.key, e.target.value)} />
              );
            })}
          </div>
        ))}
        <button type="button" className="app-btn-add" onClick={onAdd}>
          <Plus size={18} weight="bold" aria-hidden />
          {addLabel}
        </button>
      </div>
      {error && (
        <span className="ng-help" role="alert">
          <WarningCircle size={16} weight="bold" aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}
