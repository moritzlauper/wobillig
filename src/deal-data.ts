export type DealChain = 'coop' | 'migros';
export type WineType = 'red' | 'white' | 'rose' | 'sparkling' | 'dessert';
export const wineTypeLabels: Record<WineType, string> = { red: 'Rotwein', white: 'Weisswein', rose: 'Roséwein', sparkling: 'Schaumwein', dessert: 'Süsswein' };
// Naturwein is a winemaking style, so it is a flag on the offer and not a wine type.
export const wineFilterMatches = (offer: Pick<Deal, 'wineType' | 'natural'>, value: string) => !value || (value === 'natural' ? offer.natural === true : offer.wineType === value);
export type Deal = {
  id: string; chain: DealChain; product: string; quantity: string;
  category: 'food' | 'drinks' | 'household' | 'other';
  priceChf: number; previousPriceChf: number;
  priceBasis: string; unitPrice?: { amount: number; unit: 'kg' | 'l' | 'piece' };
  conditions: string; validFrom: string; validThrough: string;
  sourceUrl: string; sourcePage?: number; evidence: string;
  // Shop listings: no published end date, validThrough is the day the listing was read.
  endUnknown?: boolean; onlineOnly?: boolean; wineType?: WineType; natural?: boolean; origin?: string;
  // Branches the retailer's own store search reported as stocking the product.
  availableAt?: string[];
  // Brochure page that prints the same promotion; its dates then replace the unknown end date.
  brochure?: { url: string; page: number };
};
export type DealBranch = {
  id: string; chain: DealChain; name: string; address: string; postcode: string;
  lat: number; lon: number; sourceUrl: string;
};
export type DealBatch = {
  source: { id: string; chain: DealChain; label: string; url: string; sha256: string; fetchedAt: string; scopeLabel: string; kind?: 'brochure' | 'shop' };
  offers: Deal[]; branches: DealBranch[];
};
export type DealAssignment = { branchId: string; offerId: string; evidenceUrl: string; evidence: string; reviewedAt: string };
export type DealPilot = {
  batch?: DealBatch; fingerprint?: string; revision: number; assignments: DealAssignment[];
  lastAttemptAt: string; lastSuccessAt?: string; lastError?: string;
};
export type DealPreview = DealPilot & { expiredCount: number; upcomingCount: number; sweep?: DealBatch };
// A shop listing without end date stays visible for two more days, then needs a new sweep.
export const unknownEndDays = 2;
export const swissDay = (now = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(now);
export const lastShownDay = (offer: Deal) => offer.endUnknown ? swissDay(Date.parse(offer.validThrough + 'T12:00:00Z') + unknownEndDays * 86400000) : offer.validThrough;
export function currentDeal(offer: Deal, now = Date.now()) {
  const day = swissDay(now);
  return offer.validFrom <= day && day <= lastShownDay(offer);
}
export function visibleDealPreview(pilot: DealPilot, now = Date.now(), sweep?: DealBatch): DealPreview {
  const day = swissDay(now), offers = pilot.batch?.offers || [];
  const active = offers.filter(offer => currentDeal(offer, now)), ids = new Set(active.map(offer => offer.id));
  return { ...pilot, batch: pilot.batch ? { ...pilot.batch, offers: active } : undefined,
    assignments: pilot.assignments.filter(item => ids.has(item.offerId)),
    expiredCount: offers.filter(offer => offer.validThrough < day).length,
    upcomingCount: offers.filter(offer => offer.validFrom > day).length,
    ...(sweep ? { sweep: { ...sweep, offers: sweep.offers.filter(offer => currentDeal(offer, now)) } } : {}) };
}
export function searchDeals(offers: Deal[], query: string, chain = '', category = '', endingSoon = false, now = Date.now()) {
  const normalize = (value: string) => value.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
  const words = normalize(query).split(/\s+/).filter(Boolean);
  // "Endet bald" includes today and tomorrow in Swiss local time. Unknown end dates never qualify.
  const tomorrow = swissDay(now + 86400000);
  return offers.filter(offer => currentDeal(offer, now) && (!chain || offer.chain === chain) &&
    (!category || offer.category === category) && (!endingSoon || !offer.endUnknown && offer.validThrough <= tomorrow) &&
    words.every(word => normalize(`${offer.product} ${offer.quantity} ${offer.chain} ${offer.conditions} ${offer.origin || ''}`).includes(word)));
}
