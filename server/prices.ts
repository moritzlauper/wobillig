import { randomUUID } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { InputError, offerKey, type PriceEntry, type PriceInput } from '../src/community.js';
import type { Dataset, Offer } from '../src/data.js';

export type State = { entries: PriceEntry[]; history: PriceEntry[]; limits: Record<string, { count: number; expires: number }> };
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
export async function savePrice(store: Store, input: PriceInput, datasets: Record<'beer' | 'coffee', Dataset>, visitor: string, now = Date.now()) {
  const offer: Offer = {
    name: input.name, priceChf: input.priceChf, volumeMl: input.volumeMl, coffeeType: input.coffeeType,
    serving: input.serving, alcoholFree: input.alcoholFree, observedAt: input.observedAt,
    sourceUrl: input.sourceUrl, confidence: 'community', evidence: '',
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const old = input.id ? state.entries.find(x => x.id === input.id) : state.entries.find(x => x.barId === input.barId && x.drink === input.drink && (x.targetKey === (input.targetKey || offerKey(offer)) || offerKey(x.offer) === offerKey(offer)));
    if ((input.id && !old) || (old && (old.barId !== input.barId || old.drink !== input.drink)) || (old?.revision || 0) !== input.revision) throw new InputError('Dieser Preis wurde inzwischen geändert. Bitte schliessen und erneut öffnen.', 409);
    const targetKey = old?.targetKey || input.targetKey || offerKey(offer);
    if (!old && input.targetKey && !datasets[input.drink].bars.find(b => b.id === input.barId)?.offers.some(o => offerKey(o) === input.targetKey)) throw new InputError('Das ursprüngliche Angebot ist nicht mehr vorhanden. Bitte neu laden.', 409);
    const duplicate = state.entries.find(x => x.id !== old?.id && x.barId === input.barId && x.drink === input.drink && offerKey(x.offer) === offerKey(offer));
    if (duplicate) throw new InputError('Dieses Getränk wurde bereits eingetragen. Bitte den vorhandenen Preis ändern.', 409);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const limit = state.limits[visitor] || { count: 0, expires: now + 3600000 };
    if (limit.count >= 20) throw new InputError('Zu viele Einträge. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[visitor] = { ...limit, count: limit.count + 1 };
    const entry: PriceEntry = { id: old?.id || randomUUID(), barId: input.barId, drink: input.drink, targetKey, revision: (old?.revision || 0) + 1, updatedAt: new Date(now).toISOString(), offer };
    if (old) state.history.push(old);
    state.entries = [...state.entries.filter(x => x.id !== entry.id), entry];
    try { await store.write(state, etag); return entry; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden mehrere Preise gespeichert. Bitte erneut versuchen.', 409);
}
