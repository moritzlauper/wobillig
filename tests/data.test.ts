import mixes from './fixtures/beer-mixes.json';
import { describe, it, expect } from "vitest";
import {
  filterBars,
  cheapPriceLimit,
  isVenueEligible,
  isBeerMix,
  isComparableOffer,
  isCurrentOffer,
  bestOffer,
  matchingOffers,
  isStange,
  selectBeerSize,
  cost,
  safeUrl,
  hasOutdoorSeating,
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
  it("counts official boulevard permits as outdoor seating, seasonal ones only in season", () => {
    const inside = { ...b, outdoor: false };
    const seasonal = { ...inside, outdoorPermit: { season: "seasonal" as const, from: "02-15", until: "11-15" } };
    expect(hasOutdoorSeating(inside)).toBe(false);
    expect(hasOutdoorSeating({ ...inside, outdoorPermit: { season: "year" } })).toBe(true);
    expect(hasOutdoorSeating({ ...inside, outdoorPermit: { season: "unspecified" } })).toBe(true);
    expect(hasOutdoorSeating(seasonal, "2026-02-15")).toBe(true);
    expect(hasOutdoorSeating(seasonal, "2026-11-16")).toBe(false);
    expect(hasOutdoorSeating({ ...seasonal, outdoorPermit: { season: "seasonal", from: "11-01", until: "02-28" } }, "2027-01-10")).toBe(true);
    expect(hasOutdoorSeating({ ...seasonal, outdoor: true }, "2026-12-01")).toBe(true);
    const yearRound = { ...inside, id: "node/9", outdoorPermit: { season: "year" as const } };
    expect(filterBars([inside, yearRound], { ...f, outdoor: true }).map(bar => bar.id)).toEqual(["node/9"]);
  });
  it.each(["beer", "coffee", "pizza"] as const)("groups bars and pubs in the %s venue filter", drink => {
    const venues = ["bar", "pub", "restaurant", "cafe", "fast_food"].map(type => ({ ...b, id: type, type, offers: [] }));
    expect(filterBars(venues, { ...f, drink, type: "bar" }).map(venue => venue.id)).toEqual(["bar", "pub"]);
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

describe("coffee comparisons", () => {
  const espresso = { ...b.offers[0], name: "Espresso", coffeeType: "espresso", volumeMl: null, priceChf: 4, alcoholFree: true };
  const cappuccino = { ...espresso, name: "Cappuccino", coffeeType: "cappuccino", priceChf: 5.5 };
  const cafe = { ...b, type: "cafe", offers: [espresso, cappuccino, ...b.offers] };
  const coffee: Filters = { ...f, drink: "coffee", coffeeType: "cappuccino", volume: "500", mode: "half" };
  it("compares only the selected coffee, without a beer-size or alcohol filter", () => {
    expect(bestOffer(cafe, coffee)).toBe(cappuccino);
    expect(bestOffer(cafe, { ...coffee, coffeeType: "espresso" })).toBe(espresso);
    expect(bestOffer(cafe, { ...coffee, coffeeType: "latte" })).toBeUndefined();
    expect(bestOffer(cafe, { ...coffee, coffeeType: "all" })).toBe(espresso);
    expect(bestOffer(cafe, f)?.name).toBe("Lager");
  });
  it.each(["fast_food"])("excludes %s from coffee by default but allows an explicit selection", type => {
    for (const offers of [[], [espresso], [cappuccino], [{ ...cappuccino, confidence: "community" as const }]]) {
      const venue = { ...b, type, offers };
      expect(isVenueEligible(venue, coffee)).toBe(false);
      expect(filterBars([venue], coffee)).toEqual([]);
      const selected = { ...coffee, type };
      expect(isVenueEligible(venue, selected)).toBe(true);
      expect(filterBars([venue], selected)).toEqual([venue]);
      expect(filterBars([venue], { ...coffee, type: "all" })).toEqual([venue]);
      expect(filterBars([venue], { ...selected, unknown: false })).toHaveLength(offers.some(o => o.coffeeType === "cappuccino") ? 1 : 0);
      expect(filterBars([venue], { ...coffee, type: "restaurant" })).toEqual([]);
    }
  });
  it.each(["bar", "pub"])("includes %s in coffee by default with optional missing prices", type => {
    for (const offers of [[], [espresso], [cappuccino]]) {
      const venue = { ...b, type, offers };
      expect(filterBars([venue], coffee)).toEqual([venue]);
      expect(filterBars([venue], { ...coffee, unknown: false })).toHaveLength(offers.includes(cappuccino) ? 1 : 0);
    }
  });
  it("keeps other coffee venues and includes takeaways in beer and pizza only when selected", () => {
    for (const type of ["cafe", "restaurant", "bar", "pub"]) {
      expect(filterBars([{ ...cafe, type }], coffee)).toHaveLength(1);
    }
    for (const type of ["bar", "pub", "fast_food"]) {
      const venue = { ...b, type };
      for (const drink of ["beer", "pizza"] as const) {
        expect(filterBars([venue], { ...f, drink })).toHaveLength(type === "fast_food" ? 0 : 1);
        expect(filterBars([venue], { ...f, drink, type: "all" })).toHaveLength(1);
        expect(filterBars([venue], { ...f, drink, type: "fast_food" })).toHaveLength(type === "fast_food" ? 1 : 0);
      }
    }
  });
  it("never converts coffee prices into a fictional volume", () => {
    expect(cost(cappuccino, "half")).toBe(5.5);
    expect(cost({ ...cappuccino, volumeMl: 150 }, "half")).toBe(5.5);
    expect(filterBars([cafe], { ...coffee, max: 5 })).toHaveLength(0);
  });
  it("keeps Matcha Latte and excludes discontinued plain Matcha", () => {
    const matcha = { ...espresso, name: "Matcha", coffeeType: "matcha", priceChf: 5 };
    const latte = { ...matcha, name: "Matcha Latte", coffeeType: "matcha_latte", priceChf: 6.5 };
    const venue = { ...cafe, offers: [...cafe.offers, matcha, latte] };
    expect(bestOffer(venue, { ...coffee, coffeeType: "matcha" })).toBeUndefined();
    expect(bestOffer(venue, { ...coffee, coffeeType: "matcha_latte" })).toBe(latte);
    expect(cost(latte, "half")).toBe(6.5);
    expect(filterBars([venue], { ...coffee, coffeeType: "matcha_latte", max: 6 })).toHaveLength(0);
  });
  it("sorts matching coffees and optionally shows missing varieties", () => {
    const cheaper = { ...cafe, id: "node/2", offers: [{ ...cappuccino, priceChf: 4.5 }] };
    const noMatch = { ...cafe, id: "node/3", offers: [espresso] };
    expect(filterBars([cafe, noMatch, cheaper], coffee).map(x => x.id)).toEqual(["node/2", "node/1", "node/3"]);
    expect(filterBars([noMatch], { ...coffee, unknown: false })).toHaveLength(0);
  });
});


describe("Stange prices", () => {
  const unknownSize = { ...b.offers[0], name: "Stange", serving: "stange" as const, volumeMl: null, priceChf: 4.5 };
  const named330 = { ...unknownSize, volumeMl: 330, priceChf: 5.3 };
  const bar = { ...b, offers: [...b.offers, unknownSize, named330] };
  it("switches from normalized half litres to the actual serving price", () => {
    const filters = { ...f, mode: "half" as const } as Filters;
    selectBeerSize(filters, "stange");
    expect(filters.mode).toBe("glass");
    expect(bestOffer(bar, filters)).toBe(unknownSize);
    selectBeerSize(filters, "300");
    expect(bestOffer(bar, filters)?.priceChf).toBe(5);
  });
  it("includes 3 dl and explicitly named small Stangen, not arbitrary bottles or large servings", () => {
    expect(isStange(b.offers[0])).toBe(true);
    expect(isStange(named330)).toBe(true);
    expect(isStange({ ...b.offers[0], volumeMl: 330 })).toBe(false);
    expect(isStange({ ...named330, volumeMl: 500 })).toBe(false);
    expect(isStange({ ...named330, volumeMl: 200 })).toBe(false);
  });
  it("never normalizes a serving whose volume is unknown", () => {
    expect(cost(unknownSize, "half")).toBe(Infinity);
    expect(bestOffer({ ...bar, offers: [unknownSize] }, { ...f, mode: "half" })).toBeUndefined();
    expect(filterBars([{ ...bar, offers: [unknownSize] }], { ...f, mode: "half", unknown: false })).toHaveLength(0);
  });
});

describe('beer Ausschankart', () => {
  const draft = { ...b.offers[1], beerType: 'draft' as const, priceChf: 8 };
  const bottle = { ...draft, beerType: 'bottle' as const, priceChf: 6 };
  const bar = { ...b, offers: [draft, bottle, b.offers[1]] };
  it('compares prices within the selected Ausschankart', () => {
    expect(bestOffer(bar, { ...f, beerType: 'draft' })).toBe(draft);
    expect(bestOffer(bar, { ...f, beerType: 'bottle' })).toBe(bottle);
    expect(bestOffer(bar, { ...f, beerType: 'unknown' })).toBe(b.offers[1]);
    expect(bestOffer(bar, { ...f, beerType: 'all' })).toBe(bottle);
    expect(filterBars([bar], { ...f, beerType: 'draft', max: 7 })).toHaveLength(0);
  });
  it('does not show a known 3 dl bottle or can as a Stange', () => {
    expect(isStange({ ...b.offers[0], beerType: 'bottle' })).toBe(false);
    expect(isStange({ ...b.offers[0], beerType: 'can' })).toBe(false);
    expect(isStange({ ...b.offers[0], beerType: 'draft' })).toBe(true);
  });
  it('ignores the beer filter for coffee', () => {
    const espresso = { ...draft, coffeeType: 'espresso', volumeMl: null };
    expect(bestOffer({ ...bar, offers: [espresso] }, { ...f, drink: 'coffee', beerType: 'bottle' })).toBe(espresso);
  });
});

it('keeps estimated formats filterable and distinct from source facts', async () => {
  const { beerTypeLabel, effectiveBeerType } = await import('../src/data');
  const estimated = { ...b.offers[0], beerType: 'unknown' as const, beerTypeEstimate: { type: 'bottle' as const, method: 'ai' as const, reason: 'Gebinde' } };
  expect(effectiveBeerType(estimated)).toBe('bottle');
  expect(beerTypeLabel(estimated)).toBe('Flaschenbier · geschätzt');
  expect(isStange(estimated)).toBe(false);
  expect(bestOffer({ ...b, offers: [estimated] }, { ...f, beerType: 'bottle' })).toBe(estimated);
  expect(beerTypeLabel({ ...estimated, beerType: 'draft' })).toBe('Offenbier');
});


describe("dated menu photos", () => {
  const photo = { kind: "google_maps_photo" as const, date: "2026-04-15", dateEvidence: "15 April 2026", dateCheckedAt: "2026-10-15", validUntil: "2026-10-15" };
  it("accepts the exact six-month boundary but rejects ambiguous boundary months", () => {
    expect(isCurrentOffer({ ...b.offers[0], photoSource: photo }, "2026-10-15")).toBe(true);
    for (const date of ["2026-04-14", "2026-04", "2026-10-16", "2026-02-30", "", "2027-01"]) {
      expect(isCurrentOffer({ ...b.offers[0], photoSource: { ...photo, date } }, "2026-10-15")).toBe(false);
    }
    expect(isCurrentOffer({ ...b.offers[0], photoSource: { ...photo, date: "2026-05" } }, "2026-10-15")).toBe(true);
    expect(isCurrentOffer({ ...b.offers[0], photoSource: { ...photo, date: "2026-08-31" } }, "2027-02-28")).toBe(true);
  });
  it("keeps expired photo prices out of map and sorting even without a new deployment", () => {
    const old = { ...b.offers[0], priceChf: 1, photoSource: { ...photo, date: "2020-01" } };
    expect(bestOffer({ ...b, offers: [old, b.offers[1]] }, f)?.priceChf).toBe(7);
    expect(isCurrentOffer({ ...old, confidence: "community" }, "2026-10-15")).toBe(true);
  });
});

it.each(mixes.excluded)('excludes %s even with an explicit or estimated draft flag', name => {
  for (const beerType of ['draft', 'unknown'] as const) {
    const mix = { ...b.offers[0], name, volumeMl: 300, beerType, beerTypeEstimate: { type: 'draft' as const, reason: 'old guess', method: 'ai' as const } };
    expect(isBeerMix(name)).toBe(true);
    expect(isComparableOffer(mix)).toBe(false);
    expect(isStange(mix)).toBe(false);
    expect(bestOffer({ ...b, offers: [mix] }, { ...f, beerType: 'all' })).toBeUndefined();
    expect(bestOffer({ ...b, offers: [mix] }, { ...f, beerType: 'draft' })).toBeUndefined();
  }
});
it.each(mixes.beer)('keeps ordinary beer %s eligible', name => expect(isBeerMix(name)).toBe(false));


describe("cafés in the beer view", () => {
  const cafe: Bar = { ...b, type: "cafe", openingHours: "Mo-Fr 08:00-22:00; Sa-Su 09:00-18:00" };
  it("excludes cafés without beer even when missing prices are enabled", () => {
    const coffeeOnly = { ...b.offers[0], coffeeType: "espresso" };
    for (const offers of [[], [coffeeOnly], [{ ...b.offers[0], name: "Panaché" }]]) {
      expect(filterBars([{ ...cafe, offers }], { ...f, type: "cafe" })).toEqual([]);
    }
  });
  it("includes daytime cafés with a matching beer price and allows explicit selection", () => {
    for (const openingHours of ["Mo-Fr 08:00-18:00; Sa 08:00-17:00", "Tu-Fr 07:00-18:30; Sa-Su 09:00-17:00", "Mo-Su 09:00-19:00"]) {
      const daytime = { ...cafe, openingHours };
      expect(filterBars([daytime], f)).toHaveLength(1);
      expect(isVenueEligible(daytime, f)).toBe(true);
    }
  });
  it("keeps beer cafés with evening service or unknown hours", () => {
    for (const openingHours of [cafe.openingHours, "Tu-Fr 08:30-17:00, Sa 10:00-17:00, Th 08:30-22:00", null]) {
      expect(filterBars([{ ...cafe, openingHours }], f)).toHaveLength(1);
    }
  });
  it("still allows a missing size or format price at eligible cafés", () => {
    expect(filterBars([cafe], { ...f, beerType: "bottle" })).toHaveLength(1);
    expect(filterBars([cafe], { ...f, beerType: "bottle", unknown: false })).toHaveLength(0);
  });
  it("keeps coffee, pizza and other venue types unaffected", () => {
    const daytime = { ...cafe, openingHours: "08:00-17:00", offers: [] };
    expect(filterBars([daytime], { ...f, drink: "coffee" })).toHaveLength(1);
    expect(filterBars([daytime], { ...f, drink: "pizza" })).toHaveLength(1);
    expect(filterBars([{ ...daytime, type: "bar" }], f)).toHaveLength(1);
  });
  it("accepts newly contributed beer but ignores expired photo evidence", () => {
    const expired = { ...b.offers[0], photoSource: { kind: "google_maps_photo" as const, date: "2020-01", dateEvidence: "Jan 2020", dateCheckedAt: "2020-01-01", validUntil: "2020-07-01" } };
    expect(filterBars([{ ...cafe, offers: [expired] }], f)).toHaveLength(0);
    expect(filterBars([{ ...cafe, offers: [{ ...expired, confidence: "community" }] }], f)).toHaveLength(1);
  });
});

describe("combined 3 / 3.3 dl filter", () => {
  const draft = { ...b.offers[0], beerType: "draft" as const };
  const bottle = { ...draft, beerType: "bottle" as const, volumeMl: 330, priceChf: 5.5 };
  const stange = { ...draft, serving: "stange" as const, volumeMl: null, priceChf: 4.5 };
  const bar = { ...b, offers: [draft, bottle, stange, { ...bottle, volumeMl: 500 }, { ...draft, volumeMl: 200 }, { ...bottle, volumeMl: null }] };
  it("shows Stangen and small bottles together at their actual serving price", () => {
    const filters: Filters = { ...f, beerType: "draft", mode: "half" };
    selectBeerSize(filters, "300-330");
    expect(filters.beerType).toBe("all");
    expect(filters.mode).toBe("glass");
    expect(matchingOffers(bar, filters)).toEqual([stange, draft, bottle]);
  });
  it("still allows narrowing the combined size to bottles or draft afterwards", () => {
    expect(matchingOffers(bar, { ...f, volume: "300-330", beerType: "bottle" })).toEqual([bottle]);
    expect(matchingOffers(bar, { ...f, volume: "300-330", beerType: "draft" })).toEqual([stange, draft]);
    expect(matchingOffers(bar, { ...f, volume: "stange", beerType: "all" })).toEqual([stange, draft]);
  });
});


describe("cheap price shortcut", () => {
  const venues = (prices: number[], volumeMl = 300): Bar[] => prices.map((priceChf, i) => ({
    ...b, id: String(i), offers: [{ ...b.offers[0], priceChf, volumeMl }],
  }));
  it("targets the cheapest fifth, rounds down to CHF 0.10 and ignores the active budget", () => {
    expect(cheapPriceLimit(venues([4, 5.2, 6, 7, 8]), { ...f, max: 1 })).toBe(4.9);
    expect(cheapPriceLimit(venues([4, 5.3, 6, 7, 8]), f)).toBe(5);
    expect(cheapPriceLimit(venues([4, 5, 7, 9]), f)).toBe(4.6);
  });
  it("excludes a common price only slightly below average", () => {
    const bars = venues([3, ...Array(19).fill(4), ...Array(115).fill(4.5), ...Array(152).fill(5)]);
    const max = cheapPriceLimit(bars, f)!;
    expect(max).toBe(4.3);
    expect(filterBars(bars, { ...f, max, unknown: false })).toHaveLength(20);
  });
  it("includes the common cheap cappuccino price without requiring a 15% discount", () => {
    const bars = venues([...Array(21).fill(5), ...Array(65).fill(5.5), ...Array(159).fill(6.21)]);
    const max = cheapPriceLimit(bars, f)!;
    expect(max).toBe(5.5);
    expect(filterBars(bars, { ...f, max, unknown: false })).toHaveLength(86);
  });
  it("keeps affordable pizzas instead of only the single heavily discounted venue", () => {
    const bars = venues([12, ...Array(4).fill(17), ...Array(15).fill(20)]).map(bar => ({
      ...bar, offers: bar.offers.map(offer => ({ ...offer, volumeMl: null, pizzaType: 'margherita' as const })),
    }));
    const filters: Filters = { ...f, drink: 'pizza' };
    const max = cheapPriceLimit(bars, filters)!;
    expect(max).toBe(18);
    expect(filterBars(bars, { ...filters, max, unknown: false })).toHaveLength(5);
  });
  it("counts each venue once and leaves missing prices out", () => {
    const bars = venues([4, 5, 6, 7, 8]);
    bars[0].offers.push(...Array.from({ length: 20 }, () => ({ ...b.offers[0], priceChf: 4.1 })));
    bars.push({ ...b, offers: [] });
    expect(cheapPriceLimit(bars, f)).toBe(4.8);
  });
  it("adapts to size, normalized prices and other filters", () => {
    const bars = [...venues([4, 5, 6, 7, 8]), ...venues([6, 7, 8, 9, 10], 500).map(bar => ({ ...bar, id: 'large-' + bar.id, outdoor: false }))];
    expect(cheapPriceLimit(bars, { ...f, volume: 'stange' })).toBe(4.8);
    expect(cheapPriceLimit(bars, { ...f, volume: '500' })).toBe(6.8);
    expect(cheapPriceLimit(bars, { ...f, volume: '300', mode: 'half' })).toBe(8);
    expect(cheapPriceLimit(bars, { ...f, outdoor: true })).toBe(4.8);
    expect(cheapPriceLimit(bars, { ...f, beerType: 'bottle' })).toBeUndefined();
    expect(cheapPriceLimit(bars, { ...f, query: 'no such venue' })).toBeUndefined();
  });
  it.each(['coffee', 'pizza'] as const)("uses matching %s portions", drink => {
    const bars = venues([4, 5, 6, 7, 8]).map(bar => ({ ...bar, offers: bar.offers.map(offer => ({
      ...offer, volumeMl: null, ...(drink === 'coffee' ? { coffeeType: 'espresso' } : { pizzaType: 'margherita' as const }),
    })) }));
    expect(cheapPriceLimit(bars, { ...f, drink, coffeeType: 'espresso' })).toBe(drink === 'pizza' ? 18 : 4.8);
    expect(cheapPriceLimit(bars, { ...f, drink: 'coffee', coffeeType: 'latte' })).toBeUndefined();
  });
  it("handles empty data and keeps a result when rounding a small sample", () => {
    expect(cheapPriceLimit([], f)).toBeUndefined();
    expect(cheapPriceLimit([{ ...b, offers: [] }], f)).toBeUndefined();
    const bars = venues([5.1]);
    const max = cheapPriceLimit(bars, f)!;
    expect(max).toBe(5.1);
    expect(filterBars(bars, { ...f, max, unknown: false })).toHaveLength(1);
  });
  it("keeps tied cheapest venues without admitting higher prices in the fallback", () => {
    const bars = venues([5.1, 5.1, 5.2, 5.3]);
    const max = cheapPriceLimit(bars, f)!;
    expect(max).toBe(5.1);
    expect(filterBars(bars, { ...f, max, unknown: false })).toHaveLength(2);
    expect(cheapPriceLimit(venues([5.1, 5.1, 5.1]), f)).toBe(5.1);
  });
});
