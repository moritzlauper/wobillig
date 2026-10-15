export type Offer = {
  name: string;
  volumeMl: number | null;
  coffeeType?: string;
  priceChf: number;
  sourceUrl: string;
  observedAt: string;
  confidence: "automatic" | "reviewed";
  evidence: string;
  alcoholFree: boolean;
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
  drink?: "beer" | "coffee";
  coffeeType?: string;
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
};
export function portion(o: Offer) {
  return o.coffeeType ? coffeeLabels[o.coffeeType] || "Kaffee" : `${(o.volumeMl || 0) / 100} dl`;
}
export function matchingOffers(bar: Bar, f: Filters): Offer[] {
  return bar.offers
    .filter(
      (o) =>
        f.drink === "coffee" ? Boolean(o.coffeeType) &&
          (!f.coffeeType || f.coffeeType === "all" || o.coffeeType === f.coffeeType) :
        !o.coffeeType && o.alcoholFree === f.alcoholFree &&
        (f.volume === "all" || o.volumeMl === Number(f.volume)),
    )
    .sort((a, b) => cost(a, f.mode) - cost(b, f.mode));
}
export function bestOffer(bar: Bar, f: Filters): Offer | undefined {
  return matchingOffers(bar, f)[0];
}
export function cost(o: Offer, mode: Filters["mode"]) {
  return !o.coffeeType && mode === "half" && o.volumeMl ? (o.priceChf * 500) / o.volumeMl : o.priceChf;
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
export function filterBars(
  bars: Bar[],
  f: Filters,
  position?: [number, number],
) {
  return bars
    .filter((b) => {
      const o = bestOffer(b, f);
      return (
        `${b.name} ${b.address} ${b.postcode}`
          .toLocaleLowerCase()
          .includes(f.query.toLocaleLowerCase()) &&
        (!f.type || b.type === f.type) &&
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
      return (
        (x ? cost(x, f.mode) : Infinity) - (y ? cost(y, f.mode) : Infinity) ||
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
