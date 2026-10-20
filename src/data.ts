import { matchesSearch } from './search.js';
import { t } from './i18n.js';
import { pizzaGroup, pizzaGroupLabels, pizzaNameKey, type PizzaGroup, type PizzaSelection } from './pizza-selection.js';

export type BeerType = "draft" | "bottle" | "can" | "unknown";
export const beerTypeLabels: Record<BeerType, string> = { draft: "Offenbier", bottle: "Flaschenbier", can: "Dosenbier", unknown: "Ausschankart unbekannt" };
export type Offer = {
  name: string;
  volumeMl: number | null;
  pizzaType?: "margherita" | "other";
  priceContext?: "online_menu";
  coffeeType?: string;
  serving?: "stange";
  beerType?: BeerType;
  beerTypeEstimate?: { type: Exclude<BeerType, "unknown">; reason: string; method: "rules" | "ai"; sourceImage?: string };
  priceChf: number;
  sourceUrl: string;
  observedAt: string;
  // Explicit menu validity date, verified against the exact source document.
  verifiedMenuDate?: { date: string; evidence: string; sha256: string };
  confidence: "automatic" | "reviewed" | "community" | "ai";
  communityId?: string;
  revision?: number;
  originalKey?: string;
  evidence: string;
  ingredients?: string;
  alcoholFree: boolean;
  photoSource?: { kind: "google_maps_photo"; date: string; dateEvidence: string; dateCheckedAt: string; validUntil: string };
  menuScan?: { sha256: string; model: string };
};
export type PizzaMenuItem = Omit<Offer, "pizzaType"> & { pizzaType: "other" };
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
  outdoorPermit?: OutdoorPermit;
  offers: Offer[];
  pizzaMenu?: PizzaMenuItem[];
  scrapeStatus: string;
  checkedAt: string | null;
};
// Official boulevard permit (Basel), matched by scraper/outdoor_permits.py.
// from/until are MM-DD of a seasonal permit; "unspecified" states no season.
export type OutdoorPermit = { season: "year" | "seasonal" | "unspecified"; from?: string; until?: string; areaM2?: number };
export function hasOutdoorSeating(b: Bar, today = new Date().toISOString().slice(0, 10)) {
  const permit = b.outdoorPermit;
  if (b.outdoor || (permit && permit.season !== "seasonal")) return true;
  if (!permit?.from || !permit.until) return false;
  const day = today.slice(5);
  return permit.from <= permit.until ? permit.from <= day && day <= permit.until : day >= permit.from || day <= permit.until;
}
export type Dataset = {
  generatedAt: string;
  discoveredAt: string;
  attribution: string;
  bars: Bar[];
};
export type Filters = {
  pizzaSelection?: PizzaSelection;
  pizzaQuery?: string;
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
  matcha_latte: "Matcha Latte",
};
export function portion(o: Offer) {
  return o.pizzaType ? (o.priceContext === "online_menu" ? t('Onlinepreis') : "") : o.coffeeType ? t(coffeeLabels[o.coffeeType] || 'Kaffee') : o.volumeMl ? `${o.volumeMl / 100} dl` : t('Stange · Grösse nicht angegeben');
}
export function offerCategory(o: Offer): "beer" | "coffee" | "pizza" {
  return o.pizzaType ? "pizza" : o.coffeeType ? "coffee" : "beer";
}
// Keep in sync with scraper/beer_rules.py.
export function isBeerMix(name: string): boolean {
  return /\b(?:panach(?:e+)?|panash|henach(?:e+)?|radler|moretti\s+limone|shandy|diesel|russ(?:en)?|snakebite|black\s*(?:&|and)\s*tan|biermisch(?:getrank\w*)?|biermix\w*|beer\s*mix\w*|(?:bier|beer|lager|weizen)\s*(?:mit|with|[+&])\s*(?:cola|sprite|limonade|lemonade|zitronenlimonade))\b/i.test(name.normalize("NFKD").replace(/\p{M}/gu, ""));
}
export function isComparableOffer(o: Offer): boolean {
  return o.coffeeType !== "matcha" && (offerCategory(o) !== "beer" || !isBeerMix(o.name));
}
export function effectiveBeerType(o: Offer): BeerType {
  return o.beerType && o.beerType !== "unknown" ? o.beerType : o.beerTypeEstimate?.type || "unknown";
}
export function beerTypeLabel(o: Offer) {
  return offerCategory(o) !== "beer" ? "" : t(beerTypeLabels[effectiveBeerType(o)]) + ((!o.beerType || o.beerType === "unknown") && o.beerTypeEstimate ? ` · ${t('geschätzt')}` : "");
}
export function isStange(o: Offer) {
  return offerCategory(o) === "beer" && isComparableOffer(o) && effectiveBeerType(o) !== "bottle" && effectiveBeerType(o) !== "can" && (o.volumeMl === 300 || (o.serving === "stange" && (o.volumeMl === null || (o.volumeMl >= 300 && o.volumeMl <= 330))));
}
export function selectBeerSize(f: Filters, volume: string) {
  f.volume = volume;
  if (["stange", "300", "300-330"].includes(volume)) f.mode = "glass";
  if (volume === "300-330") f.beerType = "all";
}
export function pizzaVarieties(bars: Bar[]): { value: PizzaSelection; label: string }[] {
  const venues = new Map<PizzaGroup, Set<string>>();
  for (const bar of bars) for (const offer of [...bar.offers, ...(bar.pizzaMenu || [])]) {
    if (!isCurrentOffer(offer) || !Number.isFinite(offer.priceChf) || offer.priceChf <= 0) continue;
    const group = pizzaGroup(offer);
    if (!group) continue;
    if (!venues.has(group)) venues.set(group, new Set());
    venues.get(group)!.add(bar.id);
  }
  return (Object.entries(pizzaGroupLabels) as [PizzaGroup, string][])
    .filter(([group]) => (venues.get(group)?.size || 0) >= (group === 'funghi' ? 3 : 1))
    .map(([group, label]) => ({ value: `group:${group}` as PizzaSelection, label }));
}

// Search only sourced names and ingredients; do not infer missing ingredients.
export function matchesPizza(o: Offer, f: Filters): boolean {
  if (!o.pizzaType) return false;
  const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\b(?:proscuito|proscuitto|prosciuto)\b/g, 'prosciutto');
  const query = normalize(f.pizzaQuery || '').trim();
  if (!query) {
    if (f.pizzaSelection?.startsWith('group:')) return pizzaGroup(o) === f.pizzaSelection.slice(6);
    if (f.pizzaSelection?.startsWith('name:')) return pizzaNameKey(o.name) === f.pizzaSelection.slice(5);
    return f.pizzaSelection === 'all' || o.pizzaType === 'margherita';
  }
  const text = normalize(`${o.name} ${o.ingredients || ''}`);
  return query.split(/\s+/).every(word => text.includes(word));
}
export function matchingOffers(bar: Bar, f: Filters): Offer[] {
  return (f.drink === 'pizza' ? [...bar.offers, ...(bar.pizzaMenu || [])] : bar.offers)
    .filter(o => isCurrentOffer(o) && isComparableOffer(o))
    .filter(o => offerCategory(o) === (f.drink || "beer"))
    .filter(
      (o) =>
        f.drink === "pizza" ? matchesPizza(o, f) :
        f.drink === "coffee" ? Boolean(o.coffeeType) &&
          (!f.coffeeType || f.coffeeType === "all" || o.coffeeType === f.coffeeType) :
        !o.coffeeType && o.alcoholFree === f.alcoholFree &&
        (!f.beerType || f.beerType === "all" || effectiveBeerType(o) === f.beerType) &&
        (f.mode !== "half" || Boolean(o.volumeMl)) &&
        (f.volume === "stange" ? isStange(o) : f.volume === "300-330" ? isStange(o) || o.volumeMl === 300 || o.volumeMl === 330 : f.volume === "all" || o.volumeMl === Number(f.volume)),
    )
    .sort((a, b) => cost(a, f.mode) - cost(b, f.mode));
}
export function isCurrentOffer(o: Pick<Offer, 'photoSource' | 'confidence'>, today?: string): boolean {
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
function venueCategory(type: string): string {
  return type === "pub" ? "bar" : type;
}

export function matchesVenueType(bar: Bar, f: Filters): boolean {
  if (!f.type) return bar.type !== "fast_food";
  return f.type === "all" || venueCategory(bar.type) === f.type;
}

export function isVenueEligible(bar: Bar, f: Filters): boolean {
  if (!matchesVenueType(bar, f)) return false;
  if ((f.drink || "beer") !== "beer" || bar.type !== "cafe") return true;
  // A missing price for the selected size/format is different from no beer
  // evidence at all. Community beer entries count after applyEntries merges them.
  return bar.offers.some(o => offerCategory(o) === "beer" && isCurrentOffer(o) && isComparableOffer(o));
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
        matchesSearch(b, f.query) &&
        (!f.outdoor || hasOutdoorSeating(b)) &&
        (o ? cost(o, f.mode) <= f.max : f.unknown && !(f.drink === "pizza" && (f.pizzaQuery?.trim() || (f.pizzaSelection && f.pizzaSelection !== 'all'))))
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
// One price per venue, independent of the current budget and missing-price toggle.
export function cheapPriceLimit(bars: Bar[], f: Filters): number | undefined {
  const prices = filterBars(bars, { ...f, max: Infinity, unknown: false, sort: "price" })
    .map(bar => cost(bestOffer(bar, f)!, f.mode))
    .filter(price => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  if (!prices.length) return undefined;
  if (f.drink === "pizza") return 18;
  const index = (prices.length - 1) * .2;
  const lower = Math.floor(index);
  const quintile = prices[lower] + (prices[Math.ceil(index)] - prices[lower]) * (index - lower);
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  // Target the cheapest fifth and at least 7% below the selection's average.
  // Round down to CHF 0.10 so a common, near-average price cannot slip back in.
  // For small or uniform samples, keep the cheapest price without rounding it up.
  return Math.max(Math.floor(Math.min(quintile, average * .93) * 10) / 10, prices[0]);
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
