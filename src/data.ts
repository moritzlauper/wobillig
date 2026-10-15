export type BeerType = "draft" | "bottle" | "can" | "unknown";
export const beerTypeLabels: Record<BeerType, string> = { draft: "Offenbier", bottle: "Flaschenbier", can: "Dosenbier", unknown: "Ausschankart unbekannt" };
export type Offer = {
  name: string;
  volumeMl: number | null;
  pizzaType?: "margherita";
  priceContext?: "online_menu";
  coffeeType?: string;
  serving?: "stange";
  beerType?: BeerType;
  beerTypeEstimate?: { type: Exclude<BeerType, "unknown">; reason: string; method: "rules" | "ai"; sourceImage?: string };
  priceChf: number;
  sourceUrl: string;
  observedAt: string;
  confidence: "automatic" | "reviewed" | "community" | "ai";
  communityId?: string;
  revision?: number;
  originalKey?: string;
  evidence: string;
  alcoholFree: boolean;
  photoSource?: { kind: "google_maps_photo"; date: string; dateEvidence: string; dateCheckedAt: string; validUntil: string };
};
export type Bar = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  address: string;
  postcode: string;
  website: string | null;
  cuisine?: string[];
  pizzaEvidence?: { sourceUrl: string; evidence: string };
  openingHours: string | null;
  outdoor: boolean;
  offers: Offer[];
  scrapeStatus: string;
  checkedAt: string | null;
};
export type Dataset = {
  generatedAt: string;
  discoveredAt: string;
  attribution: string;
  bars: Bar[];
};
export type Filters = {
  drink?: "beer" | "coffee" | "pizza";
  coffeeType?: string;
  beerType?: BeerType | "all";
  query: string;
  max: number;
  volume: string;
  type: string;
  unknown: boolean;
  outdoor: boolean;
  alcoholFree: boolean;
  mode: "glass" | "half";
  sort: string;
};
export const coffeeLabels: Record<string, string> = {
  creme: "Café crème / Kaffee", espresso: "Espresso", double: "Doppelter Espresso",
  ristretto: "Ristretto", cappuccino: "Cappuccino", latte: "Latte macchiato",
  milk: "Milchkaffee", flat_white: "Flat White", americano: "Americano", filter: "Filterkaffee",
  matcha: "Matcha", matcha_latte: "Matcha Latte",
};
export function portion(o: Offer) {
  return o.pizzaType ? "Pro Pizza Margherita" + (o.priceContext === "online_menu" ? " · Onlinepreis" : "") : o.coffeeType ? coffeeLabels[o.coffeeType] || "Kaffee" : o.volumeMl ? `${o.volumeMl / 100} dl` : "Stange · Grösse nicht angegeben";
}
export function offerCategory(o: Offer): "beer" | "coffee" | "pizza" {
  return o.pizzaType ? "pizza" : o.coffeeType ? "coffee" : "beer";
}
// Keep in sync with scraper/beer_rules.py.
export function isBeerMix(name: string): boolean {
  return /\b(?:panach(?:e+)?|panash|henach(?:e+)?|radler|shandy|diesel|russ(?:en)?|snakebite|black\s*(?:&|and)\s*tan|biermisch(?:getrank\w*)?|biermix\w*|beer\s*mix\w*|(?:bier|beer|lager|weizen)\s*(?:mit|with|[+&])\s*(?:cola|sprite|limonade|lemonade|zitronenlimonade))\b/i.test(name.normalize("NFKD").replace(/\p{M}/gu, ""));
}
export function isComparableOffer(o: Offer): boolean {
  return offerCategory(o) !== "beer" || !isBeerMix(o.name);
}
export function effectiveBeerType(o: Offer): BeerType {
  return o.beerType && o.beerType !== "unknown" ? o.beerType : o.beerTypeEstimate?.type || "unknown";
}
export function beerTypeLabel(o: Offer) {
  return offerCategory(o) !== "beer" ? "" : beerTypeLabels[effectiveBeerType(o)] + ((!o.beerType || o.beerType === "unknown") && o.beerTypeEstimate ? " · geschätzt" : "");
}
export function isStange(o: Offer) {
  return offerCategory(o) === "beer" && isComparableOffer(o) && effectiveBeerType(o) !== "bottle" && effectiveBeerType(o) !== "can" && (o.volumeMl === 300 || (o.serving === "stange" && (o.volumeMl === null || (o.volumeMl >= 300 && o.volumeMl <= 330))));
}
export function selectBeerSize(f: Filters, volume: string) {
  f.volume = volume;
  if (["stange", "300", "300-330"].includes(volume)) f.mode = "glass";
  if (volume === "300-330") f.beerType = "all";
}
export function matchingOffers(bar: Bar, f: Filters): Offer[] {
  return bar.offers
    .filter(o => isCurrentOffer(o) && isComparableOffer(o))
    .filter(o => offerCategory(o) === (f.drink || "beer"))
    .filter(
      (o) =>
        f.drink === "pizza" ? o.pizzaType === "margherita" :
        f.drink === "coffee" ? Boolean(o.coffeeType) &&
          (!f.coffeeType || f.coffeeType === "all" || o.coffeeType === f.coffeeType) :
        !o.coffeeType && o.alcoholFree === f.alcoholFree &&
        (!f.beerType || f.beerType === "all" || effectiveBeerType(o) === f.beerType) &&
        (f.mode !== "half" || Boolean(o.volumeMl)) &&
        (f.volume === "stange" ? isStange(o) : f.volume === "300-330" ? isStange(o) || o.volumeMl === 300 || o.volumeMl === 330 : f.volume === "all" || o.volumeMl === Number(f.volume)),
    )
    .sort((a, b) => cost(a, f.mode) - cost(b, f.mode));
}
export function isCurrentOffer(o: Offer, today?: string): boolean {
  if (!o.photoSource || o.confidence === "community") return true;
  const photo = o.photoSource.date;
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(photo)) return false;
  const first = photo.length === 7 ? photo + "-01" : photo;
  const parsed = new Date(first + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== first) return false;
  today ||= new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(year, month - 7, 1));
  const last = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, last));
  return first >= cutoff.toISOString().slice(0, 10) && first <= today;
}
export function bestOffer(bar: Bar, f: Filters): Offer | undefined {
  return matchingOffers(bar, f)[0];
}
export function cost(o: Offer, mode: Filters["mode"]) {
  return offerCategory(o) === "beer" && mode === "half" ? (o.volumeMl ? (o.priceChf * 500) / o.volumeMl : Infinity) : o.priceChf;
}
export function distance(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dlat = (b[0] - a[0]) * r,
    dlon = (b[1] - a[1]) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// Evening means an opening interval extending beyond 19:00 on at least one
// day, not "open right now". Missing/unsupported hours remain unknown.
export function hasEveningHours(hours: string | null): boolean | undefined {
  if (!hours?.trim()) return undefined;
  const schedule = hours.replace(/"[^"]*"/g, "").trim();
  if (/\b24\/7\b/.test(schedule)) return true;
  const ranges = [...schedule.matchAll(/\b(\d{1,2}):([0-5]\d)\s*-\s*(\d{1,2}):([0-5]\d)(?!\s*(?:off|closed)\b)/g)];
  let known = false;
  for (const [, sh, sm, eh, em] of ranges) {
    const start = Number(sh) * 60 + Number(sm);
    let end = Number(eh) * 60 + Number(em);
    if (start >= 24 * 60 || end > 48 * 60) continue;
    known = true;
    if (end <= start) end += 24 * 60;
    if (end > 19 * 60) return true;
  }
  if (/\+|sunrise|sunset|dawn|dusk|unknown|open\b/i.test(schedule)) return undefined;
  if (known || /^(?:off|closed)$/i.test(schedule)) return false;
  return undefined;
}

function venueCategory(type: string): string {
  return type === "pub" ? "bar" : type;
}

export function isVenueEligible(bar: Bar, f: Filters): boolean {
  if (f.drink === "coffee" && bar.type === "fast_food") return f.type === "fast_food";
  if ((f.drink || "beer") !== "beer" || bar.type !== "cafe") return true;
  // A missing price for the selected size/format is different from no beer
  // evidence at all. Community beer entries count after applyEntries merges them.
  return bar.offers.some(o => offerCategory(o) === "beer" && isCurrentOffer(o) && isComparableOffer(o))
    && hasEveningHours(bar.openingHours) !== false;
}

export function filterBars(
  bars: Bar[],
  f: Filters,
  position?: [number, number],
) {
  return bars
    .filter((b) => {
      if (!isVenueEligible(b, f)) return false;
      const o = bestOffer(b, f);
      return (
        `${b.name} ${b.address} ${b.postcode}`
          .toLocaleLowerCase()
          .includes(f.query.toLocaleLowerCase()) &&
        (!f.type || venueCategory(b.type) === f.type) &&
        (!f.outdoor || b.outdoor) &&
        (o ? cost(o, f.mode) <= f.max : f.unknown)
      );
    })
    .sort((a, b) => {
      if (f.sort === "name") return a.name.localeCompare(b.name, "de");
      if (f.sort === "distance" && position)
        return (
          distance(position, [a.lat, a.lon]) -
          distance(position, [b.lat, b.lon])
        );
      const x = bestOffer(a, f),
        y = bestOffer(b, f);
      if (!x && y) return 1;
      if (x && !y) return -1;
      return (
        (x && y ? (cost(x, f.mode) - cost(y, f.mode)) * (f.sort === "price_desc" ? -1 : 1) : 0) ||
        a.name.localeCompare(b.name, "de")
      );
    });
}
export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function safeUrl(url: string | null) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? escapeHtml(u.href) : "";
  } catch {
    return "";
  }
}
