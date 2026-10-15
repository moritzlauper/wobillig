import { coffeeLabels, type Bar, type Dataset, type Offer } from './data.js';

export type Drink = 'beer' | 'coffee';
export type PriceEntry = {
  id: string;
  barId: string;
  drink: Drink;
  targetKey: string;
  revision: number;
  updatedAt: string;
  offer: Offer;
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
  coffeeType?: string;
  alcoholFree: boolean;
  observedAt: string;
  sourceUrl: string;
};

// Price and source are deliberately excluded: scraper refreshes must not undo corrections.
export function offerKey(o: Offer) {
  return JSON.stringify([o.name.trim().toLocaleLowerCase('de-CH'), o.volumeMl, o.coffeeType || '', o.alcoholFree]);
}
export function zurichToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date());
}
export function allVenues(datasets: Partial<Record<Drink, Dataset>>): Bar[] {
  return [...new Map(Object.values(datasets).flatMap(d => d.bars).map(b => [b.id, b])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
export function applyEntries(dataset: Dataset, entries: PriceEntry[], venues: Bar[], drink: Drink): Dataset {
  const bars = new Map(dataset.bars.map(b => [b.id, { ...b, offers: [...b.offers] }]));
  for (const entry of entries.filter(x => x.drink === drink)) {
    let bar = bars.get(entry.barId);
    if (!bar) {
      const known = venues.find(b => b.id === entry.barId);
      if (!known) continue;
      bar = { ...known, offers: [] };
      bars.set(bar.id, bar);
    }
    const replacement = { ...entry.offer, confidence: 'community' as const, communityId: entry.id, revision: entry.revision, originalKey: entry.targetKey };
    bar.offers = bar.offers.filter(o => offerKey(o) !== entry.targetKey && offerKey(o) !== offerKey(entry.offer) && o.communityId !== entry.id);
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
  if (x.drink !== 'beer' && x.drink !== 'coffee') throw new InputError('Bitte Bier oder Kaffee wählen.');
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
  if (typeof x.alcoholFree !== 'boolean') throw new InputError('Ungültige Getränkeangabe.');
  if (x.drink === 'coffee') {
    if (typeof x.coffeeType !== 'string' || !Object.hasOwn(coffeeLabels, x.coffeeType) || x.volumeMl !== null || x.serving !== undefined) throw new InputError('Bitte eine gültige Kaffeesorte wählen.');
  } else {
    if (x.coffeeType !== undefined || (x.serving !== undefined && x.serving !== 'stange')) throw new InputError('Ungültige Bierportion.');
    if (x.volumeMl === null ? x.serving !== 'stange' : !Number.isInteger(x.volumeMl) || (x.volumeMl as number) < 100 || (x.volumeMl as number) > 1000) throw new InputError('Bitte eine Menge zwischen 1 und 10 dl angeben.');
    if (x.serving === 'stange' && x.volumeMl !== null && ((x.volumeMl as number) < 300 || (x.volumeMl as number) > 330)) throw new InputError('Diese Menge ist keine Stange.');
  }
  return {
    id: x.id as string | undefined, revision: x.revision as number, barId: x.barId, drink: x.drink,
    targetKey: x.targetKey as string | undefined, name: x.name.trim(), priceChf: x.priceChf,
    volumeMl: x.volumeMl as number | null, serving: x.serving as 'stange' | undefined,
    coffeeType: x.coffeeType as string | undefined, alcoholFree: x.drink === 'coffee' || x.alcoholFree,
    observedAt: x.observedAt, sourceUrl,
  };
}
