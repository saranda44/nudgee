/**
 * Calendario de un mes para O-02 Reprogramar: reemplaza el <input type="date"> nativo (cuyo
 * selector tampoco se puede estilizar, igual que un <select>) por una grilla propia.
 * Fechas siempre en YYYY-MM-DD (comparan bien como texto, sin líos de huso horario).
 */

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";

const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m][0].toUpperCase()}${MONTH_NAMES[m].slice(1)} ${y}`;

interface Props {
  value: string;
  min: string;
  max: string;
  today: string;
  onChange: (iso: string) => void;
}

export function Calendar({ value, min, max, today, onChange }: Props) {
  const start = value >= min && value <= max ? value : min;
  const [viewYear, setViewYear] = useState(Number(start.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(start.slice(5, 7)) - 1);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const cells: Array<{ day: number; iso: string } | null> = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, iso: toIso(viewYear, viewMonth, i + 1) })),
  ];

  const monthKey = (y: number, m: number) => `${y}-${pad(m + 1)}`;
  const prevDisabled = monthKey(viewYear, viewMonth) <= min.slice(0, 7);
  const nextDisabled = monthKey(viewYear, viewMonth) >= max.slice(0, 7);

  const changeMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  return (
    <div className="app-calendar">
      <div className="app-calendar__head">
        <button type="button" className="app-iconbtn" onClick={() => changeMonth(-1)} disabled={prevDisabled} aria-label="Mes anterior">
          <CaretLeft size={18} weight="bold" aria-hidden />
        </button>
        <span className="t-body-strong">{monthLabel(viewYear, viewMonth)}</span>
        <button type="button" className="app-iconbtn" onClick={() => changeMonth(1)} disabled={nextDisabled} aria-label="Mes siguiente">
          <CaretRight size={18} weight="bold" aria-hidden />
        </button>
      </div>
      <div className="app-calendar__weekdays" aria-hidden>
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="app-calendar__grid">
        {cells.map((cell, i) => {
          if (!cell) return <span key={i} />;
          const disabled = cell.iso < min || cell.iso > max;
          const classes = ["app-calendar__day"];
          if (cell.iso === value) classes.push("is-selected");
          if (cell.iso === today) classes.push("is-today");
          return (
            <button
              key={i}
              type="button"
              className={classes.join(" ")}
              disabled={disabled}
              aria-pressed={cell.iso === value}
              onClick={() => onChange(cell.iso)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
