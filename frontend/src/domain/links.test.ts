/** NFR-06: el host de cada link es fijo aunque el texto venga manipulado. */

import { describe, expect, it } from "vitest";
import { googleBooks, googleCalendar, googleMaps, justWatch, spotifySearch, ticketSearch, youtubeShort } from "./links.ts";

const EVIL = "x\" onmouseover=alert(1) //evil.com/@evil.com?a=b&c=d#frag /../";

describe("links salientes", () => {
  it.each([
    ["youtube", youtubeShort(EVIL), "www.youtube.com"],
    ["justwatch", justWatch(EVIL, 2020), "www.justwatch.com"],
    ["maps", googleMaps(EVIL, EVIL), "www.google.com"],
    ["books", googleBooks(EVIL, EVIL), "www.google.com"],
    ["spotify", spotifySearch(EVIL), "open.spotify.com"],
    ["boletos", ticketSearch(EVIL), "www.google.com"],
    ["calendar", googleCalendar({ name: EVIL, eventDate: "2026-11-08", cityOrAddress: EVIL }), "calendar.google.com"],
  ])("%s mantiene su host y protocolo con texto malicioso", (_, href, host) => {
    const url = new URL(href);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe(host);
    expect(url.hash).toBe("");
  });

  it("el texto llega íntegro como parámetro", () => {
    expect(new URL(googleMaps("Café Tacuba", "CDMX")).searchParams.get("query")).toBe("Café Tacuba CDMX");
  });

  it("calendario: con hora dura 2 h; sin hora es de todo el día", () => {
    const withTime = new URL(googleCalendar({ name: "Jazz", eventDate: "2026-11-08", eventTime: "18:00" }));
    expect(withTime.searchParams.get("dates")).toBe("20261108T180000/20261108T200000");
    const allDay = new URL(googleCalendar({ name: "Jazz", eventDate: "2026-12-31" }));
    expect(allDay.searchParams.get("dates")).toBe("20261231/20270101");
  });
});
