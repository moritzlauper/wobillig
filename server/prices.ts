import { randomUUID } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { InputError, allVenues, offerKey, matchesOfferKey, type PriceEntry, type PriceInput } from '../src/community.js';
import type { Bar, Dataset, Offer } from '../src/data.js';
import { communityVenues } from '../src/community.js';
import { duplicateVenue, validateVenue } from '../src/venue-contributions.js';
import type { City } from '../src/cities.js';
import { priceChange, type PriceChange } from './price-audit.js';

export type ScanReceipt = { ids: string[]; added: number; unchanged: number; conflicts: number; skipped: number };
export type ScanRecord = { status: 'pending' | 'done' | 'failed'; expires: number; result?: ScanReceipt };
export type State = { entries: PriceEntry[]; history: PriceEntry[]; limits: Record<string, { count: number; expires: number }>; menuScans?: Record<string, ScanRecord>; venues?: Bar[]; priceChanges?: PriceChange[] };
export type Store = { read(): Promise<{ state: State; etag?: string }>; write(state: State, etag?: string): Promise<void> };
export const emptyState = (): State => ({ entries: [], history: [], limits: {} });
export class WriteConflict extends Error {}
export function blobStore(path = process.env.VERCEL_ENV === 'production' ? 'prices/production.json' : 'prices/development.json'): Store {
  return {
    async read() {
      // Compressed responses use weak ETags, which cannot be used for conditional writes.
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: emptyState() };
      if (result.statusCode !== 200) throw new Error('Unexpected storage response');
      const state = await new Response(result.stream).json() as State;
      if (!Array.isArray(state.entries) || !Array.isArray(state.history) || !state.limits) throw new Error('Invalid stored state');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new WriteConflict();
        throw error;
      }
    },
  };
}
export async function savePrice(store: Store, input: PriceInput, datasets: Record<'beer' | 'coffee', Dataset> & Partial<Record<'pizza' | 'locations', Dataset>>, visitor: string, now = Date.now()) {
  const offer: Offer = {
    name: input.name, priceChf: input.priceChf, volumeMl: input.volumeMl, coffeeType: input.coffeeType, pizzaType: input.pizzaType,
    serving: input.serving, beerType: input.beerType, alcoholFree: input.alcoholFree, observedAt: input.observedAt,
    sourceUrl: input.sourceUrl, confidence: 'community', evidence: '',
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const old = input.id ? state.entries.find(x => x.id === input.id) : state.entries.find(x => x.barId === input.barId && x.drink === input.drink && (x.targetKey === (input.targetKey || offerKey(offer)) || offerKey(x.offer) === offerKey(offer)));
    if ((input.id && !old) || (old && (old.barId !== input.barId || old.drink !== input.drink)) || (old?.revision || 0) !== input.revision) throw new InputError('Dieser Preis wurde inzwischen geändert. Bitte schliessen und erneut öffnen.', 409);
    const targetKey = old?.targetKey || input.targetKey || offerKey(offer);
    const originals = datasets[input.drink]?.bars.find(b => b.id === input.barId)?.offers || [];
    if (!old && input.targetKey && !originals.some(o => matchesOfferKey(o, input.targetKey!, originals))) throw new InputError('Das ursprüngliche Angebot ist nicht mehr vorhanden. Bitte neu laden.', 409);
    const duplicate = state.entries.find(x => x.id !== old?.id && x.barId === input.barId && x.drink === input.drink && offerKey(x.offer) === offerKey(offer));
    if (duplicate) throw new InputError('Dieses Angebot wurde bereits eingetragen. Bitte den vorhandenen Preis ändern.', 409);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const limit = state.limits[visitor] || { count: 0, expires: now + 3600000 };
    if (limit.count >= 20) throw new InputError('Zu viele Einträge. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[visitor] = { ...limit, count: limit.count + 1 };
    const venue = communityVenues(datasets, state.entries, state.venues).find(b => b.id === input.barId);
    if (!venue) throw new InputError('Dieses Lokal ist nicht mehr verfügbar. Bitte neu laden.');
    const entry: PriceEntry = { id: old?.id || randomUUID(), barId: input.barId, drink: input.drink, targetKey, revision: (old?.revision || 0) + 1, updatedAt: new Date(now).toISOString(), offer, venue: { ...venue, offers: [] } };
    // The edit and its audit record commit atomically under the same ETag.
    state.priceChanges = [...(state.priceChanges || []), priceChange(entry, old, datasets[input.drink])];
    if (old) state.history.push(old);
    state.entries = [...state.entries.filter(x => x.id !== entry.id), entry];
    try { await store.write(state, etag); return entry; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden mehrere Preise gespeichert. Bitte erneut versuchen.', 409);
}

export async function saveVenue(store: Store, value: unknown, datasets: Parameters<typeof allVenues>[0], city: City, visitor: string, now = Date.now()) {
  const input = validateVenue(value, city);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const duplicate = duplicateVenue(input, communityVenues(datasets, state.entries, state.venues));
    // Retrying after a lost response must not create a second location.
    if (duplicate) return { venue: duplicate, created: false };
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const key = `venue:${visitor}`;
    const limit = state.limits[key] || { count: 0, expires: now + 3600000 };
    if (limit.count >= 5) throw new InputError('Zu viele neue Lokale. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[key] = { ...limit, count: limit.count + 1 };
    const venue: Bar = { ...input, id: `community/${randomUUID()}`, website: input.website || null,
      openingHours: null, offers: [], scrapeStatus: 'community', checkedAt: new Date(now).toISOString() };
    state.venues = [...(state.venues || []), venue];
    try { await store.write(state, etag); return { venue, created: true }; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden weitere Lokale gespeichert. Bitte erneut versuchen.', 409);
}
