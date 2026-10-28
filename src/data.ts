import { matchesSearch } from './search.js';
import { t } from './i18n.js';
import { pizzaGroup, pizzaGroupLabels, pizzaNameKey, type PizzaGroup, type PizzaSelection } from './pizza-selection.js';
import { beerGroup, beerGroupLabels, normalizeBeerName, type BeerSelection } from './beer-selection.js';
import { type BurgerSelection } from './burger-selection.js';
import { isGlutenFreeOffer, isGlutenFreePizzeria } from './gluten-free.js';

export type BeerType = "draft" | "bottle" | "can" | "unknown";
export const beerTypeLabels: Record<BeerType, string> = { draft: "Offenbier", bottle: "Flaschenbier", can: "Dosenbier", unknown: "Ausschankart unbekannt" };
export type Offer = {
  name: string;
  volumeMl: number | null;
  pizzaType?: "margherita" | "other";
  ramenType?: "ramen";
  burgerType?: "burger";
  burgerDiet?: "standard" | "vegetarian" | "vegan";
  // Explicit label from the menu; text labels are checked in isGlutenFreeOffer.
  glutenFree?: boolean;
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
  drink?: "beer" | "coffee" | "pizza" | "ramen" | "burger";
  burgerSelection?: BurgerSelection;
  coffeeType?: string;
  beerType?: BeerType | "all";
  beerQuery?: string;
  beerSelection?: BeerSelection;
  glutenFree?: boolean;
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
  return o.pizzaType ? (o.priceContext === "online_menu" ? t('Onlinepreis') : "") : (o.ramenType || o.burgerType) ? t('Standardportion') : o.coffeeType ? t(coffeeLabels[o.coffeeType] || 'Kaffee') : o.volumeMl ? `${o.volumeMl / 100} dl` : t('Stange · Grösse nicht angegeben');
}
export function offerCategory(o: Offer): "beer" | "coffee" | "pizza" | "ramen" | "burger" {
  return o.burgerType ? "burger" : o.ramenType ? "ramen" : o.pizzaType ? "pizza" : o.coffeeType ? "coffee" : "beer";
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
    .sort(([a, labelA], [b, labelB]) => {
      if (a === 'vegetariana') return -1;
      if (b === 'vegetariana') return 1;
      return venues.get(b)!.size - venues.get(a)!.size || labelA.localeCompare(labelB, 'de');
    })
    .map(([group, label]) => ({ value: `group:${group}` as PizzaSelection, label }));
}

// A pizza is gluten-free by its own label or by a gluten-free pizzeria.
export function isGlutenFreePizza(o: Offer, bar: Bar): boolean {
  return isGlutenFreePizzeria(bar) || isGlutenFreeOffer(o);
}
export function hasGlutenFreePizza(bars: Bar[]): boolean {
  return bars.some(bar => [...bar.offers, ...(bar.pizzaMenu || [])].some(o => o.pizzaType && isCurrentOffer(o) && isGlutenFreePizza(o, bar)));
}

// Search only sourced names and ingredients; do not infer missing ingredients.
export function matchesPizza(o: Offer, f: Filters, bar?: Bar): boolean {
  if (!o.pizzaType) return false;
  const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\b(?:proscuito|proscuitto|prosciuto)\b/g, 'prosciutto');
  const query = normalize(f.pizzaQuery || '').trim();
  if (!query) {
    if (f.pizzaSelection?.startsWith('group:')) return pizzaGroup(o) === f.pizzaSelection.slice(6);
    if (f.pizzaSelection?.startsWith('name:')) return pizzaNameKey(o.name) === f.pizzaSelection.slice(5);
    if (f.pizzaSelection === 'glutenfree') return bar !== undefined && isGlutenFreePizza(o, bar);
    return f.pizzaSelection === 'all' || o.pizzaType === 'margherita';
  }
  const text = normalize(`${o.name} ${o.ingredients || ''}`);
  return query.split(/\s+/).every(word => text.includes(word));
}
export function matchesBeerName(name: string, query = ''): boolean {
  const text = normalizeBeerName(name);
  return normalizeBeerName(query).split(/\s+/).every(word => text.includes(word));
}
export function hasBeerSelection(f: Filters): boolean {
  return (f.drink || 'beer') === 'beer' && Boolean(f.beerSelection || f.beerQuery?.trim());
}
export function beerVarieties(bars: Bar[]): { value: BeerSelection; label: string }[] {
  const venues = new Map<BeerSelection, Set<string>>();
  for (const bar of bars) for (const offer of bar.offers) {
    if (offerCategory(offer) !== 'beer' || !isCurrentOffer(offer) || !isComparableOffer(offer)
      || !Number.isFinite(offer.priceChf) || offer.priceChf <= 0) continue;
    const group = beerGroup(offer.name);
    if (!group) continue;
    if (!venues.has(group)) venues.set(group, new Set());
    venues.get(group)!.add(bar.id);
  }
  return [...venues].sort(([a, idsA], [b, idsB]) => idsB.size - idsA.size
    || beerGroupLabels[a].localeCompare(beerGroupLabels[b], 'de'))
    .map(([value]) => ({ value, label: beerGroupLabels[value] }));
}
// Vegan burgers are vegetarian too, so the vegetarian choice keeps them.
const burgerChoices: Record<BurgerSelection, (o: Offer) => boolean> = {
  all: () => true,
  vegetarian: o => o.burgerDiet === "vegetarian" || o.burgerDiet === "vegan",
  vegan: o => o.burgerDiet === "vegan",
  glutenfree: o => isGlutenFreeOffer(o),
};
export function matchesBurger(o: Offer, f: Filters): boolean {
  return Boolean(o.burgerType) && burgerChoices[f.burgerSelection || "all"](o);
}
export function matchingOffers(bar: Bar, f: Filters): Offer[] {
  return (f.drink === 'pizza' ? [...bar.offers, ...(bar.pizzaMenu || [])] : bar.offers)
    .filter(o => isCurrentOffer(o) && isComparableOffer(o))
    .filter(o => offerCategory(o) === (f.drink || "beer"))
    .filter(
      (o) =>
        f.drink === "pizza" ? matchesPizza(o, f, bar) :
        f.drink === "ramen" ? Boolean(o.ramenType) :
        f.drink === "burger" ? matchesBurger(o, f) :
        f.drink === "coffee" ? Boolean(o.coffeeType) &&
          (!f.coffeeType || f.coffeeType === "all" || o.coffeeType === f.coffeeType) :
        !o.coffeeType && o.alcoholFree === f.alcoholFree && (!f.glutenFree || isGlutenFreeOffer(o)) &&
        matchesBeerName(o.name, f.beerQuery) &&
        (f.beerQuery?.trim() || !f.beerSelection || beerGroup(o.name) === f.beerSelection) &&
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
        (o ? cost(o, f.mode) <= f.max : f.unknown &&
          !hasBeerSelection(f) &&
          !(f.drink === "pizza" && (f.pizzaQuery?.trim() || (f.pizzaSelection && f.pizzaSelection !== 'all'))))
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
  // Cheap mode is on by default, so it must not leave a sparse map. Target the
  // cheapest third, but at least ten venues or, for small selections, the cheaper half.
  const minimum = Math.min(10, Math.ceil(prices.length / 2));
  const target = Math.max(Math.ceil(prices.length / 3), minimum);
  const boundary = prices[target - 1];
  const included = prices.filter(price => price <= boundary).length;
  const below = prices.filter(price => price < boundary);
  // Many venues often share the boundary price. Use the next lower price when
  // its count is relatively at least as close to the target as including all ties,
  // or when the ties would otherwise keep every venue.
  const stepDown = below.length > 0 && (included === prices.length || below.length * included >= target ** 2);
  const limit = stepDown ? below[below.length - 1] : boundary;
  // CHF 18 is the Margherita shortcut. Other varieties and ingredient searches
  // use their own matching prices, just like the drink selections above.
  // Districts without a Margherita up to CHF 18 still keep their cheapest venues.
  if (f.drink === "pizza" && !f.pizzaSelection && !f.pizzaQuery?.trim()) return Math.max(18, limit);
  // Tightly clustered prices can put the third just below the average shown next
  // to the button. Stay at least 3% below it while the minimum of venues remains.
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const belowAverage = prices.filter(price => price <= Math.min(limit, average * .97));
  return belowAverage.length >= minimum ? belowAverage[belowAverage.length - 1] : limit;
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
