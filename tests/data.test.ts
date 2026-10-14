import { describe, it, expect } from "vitest";
import {
  filterBars,
  bestOffer,
  cost,
  safeUrl,
  type Bar,
  type Filters,
} from "../src/data";
const f: Filters = {
  query: "",
  max: 8,
  volume: "all",
  type: "",
  unknown: true,
  outdoor: false,
  alcoholFree: false,
  mode: "glass",
  sort: "price",
};
const b: Bar = {
  id: "node/1",
  name: "Züri Bar",
  lat: 47.38,
  lon: 8.53,
  type: "bar",
  address: "Langstrasse 1",
  postcode: "8004",
  website: null,
  openingHours: null,
  outdoor: true,
  scrapeStatus: "prices_found",
  checkedAt: null,
  offers: [
    {
      name: "Lager",
      priceChf: 5,
      volumeMl: 300,
      sourceUrl: "https://example.com",
      observedAt: "2026-10-14",
      confidence: "automatic",
      evidence: "",
      alcoholFree: false,
    },
    {
      name: "Lager",
      priceChf: 7,
      volumeMl: 500,
      sourceUrl: "https://example.com",
      observedAt: "2026-10-14",
      confidence: "automatic",
      evidence: "",
      alcoholFree: false,
    },
  ],
};
describe("bar discovery", () => {
  it("compares equivalent volumes when enabled", () => {
    expect(bestOffer(b, f)?.priceChf).toBe(5);
    expect(bestOffer(b, { ...f, mode: "half" })?.priceChf).toBe(7);
    expect(cost(b.offers[0], "half")).toBeCloseTo(8.333);
  });
  it("does not present a 2 dl glass as a cheaper half litre", () => {
    const small = { ...b.offers[0], volumeMl: 200, priceChf: 5.7 };
    const bar = { ...b, offers: [small, b.offers[1]] };
    expect(cost(small, "half")).toBe(14.25);
    expect(bestOffer(bar, { ...f, mode: "half" })?.volumeMl).toBe(500);
    expect(
      filterBars([{ ...bar, offers: [small] }], { ...f, mode: "half", max: 6 }),
    ).toHaveLength(0);
  });
  it("keeps unknown venues visible by choice", () => {
    const unknown = { ...b, id: "node/2", offers: [] };
    expect(filterBars([unknown, b], f).map((b) => b.id)).toEqual([
      "node/1",
      "node/2",
    ]);
    expect(filterBars([unknown, b], { ...f, unknown: false })).toHaveLength(1);
  });
  it("combines price, size, search and outdoor filters", () => {
    expect(filterBars([b], { ...f, volume: "500", max: 6 })).toHaveLength(0);
    expect(
      filterBars([b], { ...f, query: "8004", outdoor: true }),
    ).toHaveLength(1);
    expect(filterBars([b], { ...f, query: "Basel" })).toHaveLength(0);
  });
  it("keeps non-alcoholic offers separate", () =>
    expect(bestOffer(b, { ...f, alcoholFree: true })).toBeUndefined());
  it("rejects executable source links", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("https://example.com/menu")).toBe(
      "https://example.com/menu",
    );
  });
});
