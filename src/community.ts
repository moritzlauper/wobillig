import { isBeerMix, coffeeLabels, beerTypeLabels, safeUrl, type BeerType, type Bar, type Dataset, type Offer } from './data.js';

export type Drink = 'beer' | 'coffee' | 'pizza';
export type PriceEntry = {
  id: string;
  barId: string;
  drink: Drink;
  targetKey: string;
  revision: number;
  updatedAt: string;
  offer: Offer;
  venue?: Bar;
};
export type PriceInput = {
  id?: string;
  revision: number;
  barId: string;
  drink: Drink;
  targetKey?: string;
  name: string;
  priceChf: number;
  volumeMl: number | null;
  serving?: 'stange';
  beerType?: BeerType;
  coffeeType?: string;
  pizzaType?: 'margherita';
  alcoholFree: boolean;
  observedAt: string;
  sourceUrl: string;
};

// Price and source are deliberately excluded: scraper refreshes must not undo corrections.
export function offerKey(o: Offer) {
  const key: (string | number | boolean | null)[] = [o.name.trim().toLocaleLowerCase('de-CH'), o.volumeMl, o.coffeeType || '', o.alcoholFree];
  if (o.pizzaType) key.push(o.pizzaType);
  if (!o.coffeeType && o.beerType && o.beerType !== 'unknown') key.push(o.beerType);
  return JSON.stringify(key);
}
// Old corrections without an Ausschankart remain valid only for a unique match.
export function matchesOfferKey(o: Offer, key: string, offers: Offer[]) {
  return offerKey(o) === key || (offerKey({ ...o, beerType: undefined }) === key &&
    offers.filter(candidate => offerKey({ ...candidate, beerType: undefined }) === key).length === 1);
}
export function zurichToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date());
}
export function allVenues(datasets: Partial<Record<Drink | 'locations', Dataset>>): Bar[] {
  const { locations, ...priced } = datasets;
  return [...new Map([locations, ...Object.values(priced)].flatMap(d => d?.bars || []).map(b => [b.id, b])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
// Persisted location snapshots keep contributions visible across catalogue updates.
// Canonical scraper metadata wins when the location later joins a dataset.
export function communityVenues(datasets: Partial<Record<Drink | 'locations', Dataset>>, entries: PriceEntry[], added: Bar[] = []): Bar[] {
  return [...new Map([...added.map(bar => ({ ...bar, offers: [] })), ...entries.flatMap(entry => entry.venue && entry.venue.id === entry.barId ? [{ ...entry.venue, offers: [] }] : []),
    ...allVenues(datasets)].map(bar => [bar.id, bar])).values()];
}
function verifiedWebsiteUpdate(offer: Offer, entry: PriceEntry): boolean {
  const proof = offer.verifiedMenuDate;
  if (offer.confidence !== 'reviewed' || offer.communityId || offer.menuScan || offer.photoSource || !safeUrl(offer.sourceUrl)
      || !proof || typeof proof.evidence !== 'string' || !proof.evidence.trim() || !/^[a-f\d]{64}$/i.test(proof.sha256)
      || !/^\d{4}-\d{2}-\d{2}$/.test(proof.date) || !Number.isFinite(Date.parse(proof.date))
      || new Date(proof.date).toISOString().slice(0, 10) !== proof.date || proof.date > zurichToday()
      || !Number.isFinite(Date.parse(entry.updatedAt))) return false;
  const submitted = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date(entry.updatedAt));
  // A photo may show an older menu. The contribution's actual upload/edit date
  // is the minimum cutoff, never the scraper's most recent fetch timestamp.
  const cutoff = [submitted, entry.offer.observedAt.slice(0, 10)].sort().at(-1)!;
  return proof.date > cutoff;
}
export function applyEntries(dataset: Dataset, entries: PriceEntry[], venues: Bar[], drink: Drink): Dataset {
  // Drinks share locations; pizza only includes known pizza venues and pizza entries.
  const bars = new Map((drink === 'pizza' ? [] : venues).map(b => [b.id, { ...b, offers: [] as Offer[] }]));
  for (const b of dataset.bars) bars.set(b.id, { ...b, offers: [...b.offers] });
  for (const entry of entries.filter(x => x.drink === drink)) {
    let bar = bars.get(entry.barId);
    if (!bar) {
      const known = venues.find(b => b.id === entry.barId) || (entry.venue?.id === entry.barId ? entry.venue : undefined);
      if (!known) continue;
      bar = { ...known, offers: [] };
      bars.set(bar.id, bar);
    }
    const original = bar.offers.find(o => matchesOfferKey(o, entry.targetKey, bar!.offers));
    const newer = bar.offers.filter(o => offerKey(o) === offerKey(entry.offer) && verifiedWebsiteUpdate(o, entry))
      .sort((a, b) => b.verifiedMenuDate!.date.localeCompare(a.verifiedMenuDate!.date));
    // Conflicting prices on equally recent verified menus do not override an upload.
    const website = newer[0] && newer[0].priceChf !== entry.offer.priceChf && newer.filter(o => o.verifiedMenuDate!.date === newer[0].verifiedMenuDate!.date)
      .every(o => o.priceChf === newer[0].priceChf) ? newer[0] : undefined;
    const chosen = website || { ...entry.offer, beerType: entry.offer.beerType ?? original?.beerType,
      beerTypeEstimate: entry.offer.beerType === undefined ? original?.beerTypeEstimate : undefined,
      confidence: entry.offer.menuScan ? 'ai' as const : 'community' as const };
    // Keep the contribution in storage and retain its edit/revision identity.
    const replacement = { ...chosen, communityId: entry.id, revision: entry.revision, originalKey: entry.targetKey };
    bar.offers = bar.offers.filter(o => !matchesOfferKey(o, entry.targetKey, bar.offers) && offerKey(o) !== offerKey(entry.offer) && o.communityId !== entry.id);
    bar.offers.push(replacement);
  }
  return { ...dataset, bars: [...bars.values()] };
}
export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validateInput(value: unknown, venues: Bar[], today = zurichToday()): PriceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Ungültiger Eintrag.');
  const x = value as Record<string, unknown>;
  if (typeof x.barId !== 'string' || !venues.some(b => b.id === x.barId)) throw new InputError('Bitte ein Lokal aus der Liste wählen.');
  if (x.drink !== 'beer' && x.drink !== 'coffee' && x.drink !== 'pizza') throw new InputError('Bitte Bier, Kaffee oder Pizza Margherita wählen.');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.trim().length > 100 || /[\x00-\x1f]/.test(x.name)) throw new InputError('Bitte eine Bezeichnung mit höchstens 100 Zeichen eingeben.');
  if (typeof x.priceChf !== 'number' || !Number.isFinite(x.priceChf) || x.priceChf < .5 || x.priceChf > 50 || Math.abs(x.priceChf * 100 - Math.round(x.priceChf * 100)) > 0.00001) throw new InputError('Der Preis muss zwischen CHF 0.50 und CHF 50 liegen (maximal zwei Nachkommastellen).');
  if (typeof x.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.observedAt) || !Number.isFinite(Date.parse(x.observedAt)) || new Date(x.observedAt).toISOString().slice(0,10) !== x.observedAt || x.observedAt < '2020-01-01' || x.observedAt > today) throw new InputError('Bitte ein gültiges Datum bis heute wählen.');
  if (typeof x.sourceUrl !== 'string' || x.sourceUrl.length > 1500) throw new InputError('Ungültiger Quellenlink.');
  let sourceUrl = x.sourceUrl.trim();
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      sourceUrl = url.href;
    } catch { throw new InputError('Der Quellenlink muss mit https:// oder http:// beginnen.'); }
  }
  if (!Number.isInteger(x.revision) || (x.revision as number) < 0) throw new InputError('Ungültige Version. Bitte neu laden.');
  if (x.id !== undefined && (typeof x.id !== 'string' || !/^[\da-f-]{36}$/i.test(x.id))) throw new InputError('Ungültige Eintrags-ID.');
  if (x.targetKey !== undefined && (typeof x.targetKey !== 'string' || x.targetKey.length > 1000)) throw new InputError('Ungültiges Angebot.');
  if (typeof x.alcoholFree !== 'boolean') throw new InputError('Ungültige Produktangabe.');
  if (x.drink !== 'pizza' && x.pizzaType !== undefined) throw new InputError('Ungültige Pizzasorte.');
  if (x.drink === 'pizza') {
    if (x.pizzaType !== 'margherita' || x.volumeMl !== null || x.coffeeType !== undefined || x.beerType !== undefined || x.serving !== undefined) throw new InputError('Bitte eine ganze Pizza Margherita ohne Getränkeangaben eintragen.');
    if (!/^(?:pizza\s+)?margh?erita$/i.test(x.name.trim())) throw new InputError('Hier werden nur normale Pizza Margherita verglichen.');
  } else if (x.drink === 'coffee') {
    if (x.beerType !== undefined) throw new InputError('Kaffee hat keine Bier-Ausschankart.');
    if (typeof x.coffeeType !== 'string' || !Object.hasOwn(coffeeLabels, x.coffeeType) || x.volumeMl !== null || x.serving !== undefined) throw new InputError('Bitte eine gültige Kaffeesorte wählen.');
  } else {
    if (isBeerMix(x.name)) throw new InputError('Biermischgetränke wie Panaché oder Radler gehören nicht in den Biervergleich.');
    if (x.beerType !== undefined && (typeof x.beerType !== 'string' || !Object.hasOwn(beerTypeLabels, x.beerType))) throw new InputError('Bitte eine gültige Ausschankart wählen.');
    if (x.serving === 'stange' && (x.beerType === 'bottle' || x.beerType === 'can')) throw new InputError('Flaschen- und Dosenbier ist keine Stange.');
    if (x.coffeeType !== undefined || (x.serving !== undefined && x.serving !== 'stange')) throw new InputError('Ungültige Bierportion.');
    if (x.volumeMl === null ? x.serving !== 'stange' : !Number.isInteger(x.volumeMl) || (x.volumeMl as number) < 100 || (x.volumeMl as number) > 1000) throw new InputError('Bitte eine Menge zwischen 1 und 10 dl angeben.');
    if (x.serving === 'stange' && x.volumeMl !== null && ((x.volumeMl as number) < 300 || (x.volumeMl as number) > 330)) throw new InputError('Diese Menge ist keine Stange.');
  }
  return {
    id: x.id as string | undefined, revision: x.revision as number, barId: x.barId, drink: x.drink,
    targetKey: x.targetKey as string | undefined, name: x.drink === 'pizza' ? 'Pizza Margherita' : x.name.trim(), priceChf: x.priceChf,
    volumeMl: x.volumeMl as number | null, serving: x.serving as 'stange' | undefined,
    beerType: x.drink === 'beer' ? (x.beerType as BeerType | undefined) || 'unknown' : undefined,
    coffeeType: x.coffeeType as string | undefined, pizzaType: x.drink === 'pizza' ? 'margherita' : undefined, alcoholFree: x.drink !== 'beer' || x.alcoholFree,
    observedAt: x.observedAt, sourceUrl,
  };
}
