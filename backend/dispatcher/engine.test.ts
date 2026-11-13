/**
 * Tests del motor de recordatorios (RF §5): slotKey local y elección/orden de candidatos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, planSlot, slotKeyFor, type Candidate } from "./engine.ts";

const TZ = "America/Mexico_City"; // UTC-6 sin horario de verano
// "Ahora": 15-jun-2026 09:02 en Ciudad de México
const NOW = new Date("2026-06-15T15:02:00Z");

let seq = 0;
function item(overrides: Partial<Candidate> = {}): Candidate {
  seq++;
  const savedAt = `2026-06-0${(seq % 9) + 1}T10:00:00Z`;
  const videoId = overrides.videoId ?? `vid${String(seq).padStart(8, "0")}`;
  return { videoId, GSI1SK: `${savedAt}#${videoId}`, category: "RECIPE", notifyCount: 0, ...overrides };
}

const ids = (cs: Candidate[]) => cs.map((c) => c.videoId);

describe("slotKeyFor", () => {
  it("usa la fecha y hora local del usuario, no la de UTC", () => {
    // 19:00 en CDMX = 01:00 UTC del día siguiente
    assert.equal(slotKeyFor(new Date("2026-06-16T01:00:00Z"), TZ), "2026-06-15T19");
  });

  it("funciona en zonas con desfase de media hora", () => {
    assert.equal(slotKeyFor(new Date("2026-06-15T03:30:00Z"), "Asia/Kolkata"), "2026-06-15T09");
  });

  it("usa la hora agendada, no la de ejecución (ventana flexible de 5 min)", () => {
    assert.equal(slotKeyFor(new Date("2026-06-15T15:00:00Z"), TZ), "2026-06-15T09");
  });
});

describe("planSlot", () => {
  it("ordena: reprogramados para hoy → eventos próximos → resto del más viejo al más nuevo", () => {
    const old = item({ videoId: "old", GSI1SK: "2026-01-01T00:00:00Z#old" });
    const recent = item({ videoId: "recent", GSI1SK: "2026-06-10T00:00:00Z#recent" });
    const eventFar = item({ videoId: "evFar", category: "EVENT", eventDate: "2026-06-20" });
    const eventNear = item({ videoId: "evNear", category: "EVENT", eventDate: "2026-06-16" });
    const eventOutside = item({ videoId: "evOut", category: "EVENT", eventDate: "2026-07-30", GSI1SK: "2026-03-01T00:00:00Z#evOut" });
    const resToday = item({ videoId: "resToday", scheduledFor: "2026-06-15" });
    const resOverflow = item({ videoId: "resOver", scheduledFor: "2026-06-14" });

    const { ordered, dormant } = planSlot(
      [recent, eventFar, old, resToday, eventOutside, eventNear, resOverflow],
      NOW,
      TZ,
      DEFAULT_CONFIG,
    );
    assert.deepEqual(ids(ordered), ["resOver", "resToday", "evNear", "evFar", "old", "evOut", "recent"]);
    assert.deepEqual(dormant, []);
  });

  it("excluye pospuestos, reprogramados a futuro, eventos pasados y los que siguen en cooldown", () => {
    const candidates = [
      item({ videoId: "snoozed", snoozeUntil: "2026-06-15T16:00:00Z" }),
      item({ videoId: "snoozeOver", snoozeUntil: "2026-06-15T15:00:00Z" }),
      item({ videoId: "future", scheduledFor: "2026-06-16" }),
      item({ videoId: "pastEvent", category: "EVENT", eventDate: "2026-06-14" }),
      item({ videoId: "eventToday", category: "EVENT", eventDate: "2026-06-15" }),
      item({ videoId: "cooling", lastNotifiedAt: "2026-06-13T15:00:00Z" }), // hace 2 días
      item({ videoId: "cooled", lastNotifiedAt: "2026-06-12T15:00:00Z" }), // hace 3 días
    ];
    const { ordered } = planSlot(candidates, NOW, TZ, DEFAULT_CONFIG);
    assert.deepEqual(ids(ordered).sort(), ["cooled", "eventToday", "snoozeOver"]);
  });

  it("un evento pasado se juzga con la fecha local, no la de UTC", () => {
    // 15-jun 20:00 en CDMX = 16-jun 02:00 UTC: el evento del 15 sigue siendo de hoy
    const late = new Date("2026-06-16T02:00:00Z");
    const { ordered } = planSlot([item({ videoId: "ev", category: "EVENT", eventDate: "2026-06-15" })], late, TZ, DEFAULT_CONFIG);
    assert.deepEqual(ids(ordered), ["ev"]);
  });

  it("un reprogramado cuyo día llegó ignora el cooldown", () => {
    const c = item({ videoId: "res", scheduledFor: "2026-06-15", lastNotifiedAt: "2026-06-14T15:00:00Z" });
    assert.deepEqual(ids(planSlot([c], NOW, TZ, DEFAULT_CONFIG).ordered), ["res"]);
  });

  it("separa los que llegaron al máximo de recordatorios ignorados (T-07)", () => {
    const tired = item({ videoId: "tired", notifyCount: 3 });
    const fine = item({ videoId: "fine", notifyCount: 2 });
    const { ordered, dormant } = planSlot([tired, fine], NOW, TZ, DEFAULT_CONFIG);
    assert.deepEqual(ids(dormant), ["tired"]);
    assert.deepEqual(ids(ordered), ["fine"]);
  });

  it("respeta la configuración de demo (NFR-11)", () => {
    const c = item({ videoId: "c", lastNotifiedAt: "2026-06-15T14:55:00Z" }); // hace 7 min
    const demo = { ...DEFAULT_CONFIG, cooldownMinutes: 5 };
    assert.deepEqual(ids(planSlot([c], NOW, TZ, demo).ordered), ["c"]);
    assert.deepEqual(ids(planSlot([c], NOW, TZ, DEFAULT_CONFIG).ordered), []);
  });
});
