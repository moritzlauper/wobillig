import { describe, it, expect } from 'vitest';
import { applyEntries, offerKey, validateInput, type PriceInput } from '../src/community';
import { emptyState, savePrice, WriteConflict, type State, type Store } from '../server/prices';
import type { Bar, Dataset, Offer } from '../src/data';
const offer: Offer = { name: 'Lager', priceChf: 7, volumeMl: 500, sourceUrl: 'https://example.org/menu', observedAt: '2026-10-14', confidence: 'automatic', evidence: '', alcoholFree: false };
const bar: Bar = { id: 'node/1', name: 'Testbar', lat: 47.37, lon: 8.53, address: '', postcode: '', type: 'bar', website: null, openingHours: null, outdoor: false, offers: [offer], scrapeStatus: 'prices_found', checkedAt: null };
const beer: Dataset = { generatedAt: '', discoveredAt: '', attribution: '', bars: [bar] };
const coffee: Dataset = { ...beer, bars: [] };
const data = { beer, coffee };
const input: PriceInput = { barId: bar.id, drink: 'beer', revision: 0, name: 'Lager', priceChf: 6.5, volumeMl: 500, alcoholFree: false, observedAt: '2026-10-14', sourceUrl: '', targetKey: offerKey(offer) };
function memoryStore() {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next: State, etag?: string) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  } satisfies Store;
}
describe('shared price validation', () => {
  it('accepts real glass prices and coffee with no made-up volume', () => {
    expect(validateInput(input, [bar]).priceChf).toBe(6.5);
    expect(validateInput({ ...input, drink: 'coffee', coffeeType: 'espresso', volumeMl: null }, [bar]).alcoholFree).toBe(true);
    expect(validateInput({ ...input, volumeMl: null, serving: 'stange' }, [bar]).volumeMl).toBeNull();
  });
  it.each([
    { priceChf: NaN }, { priceChf: 0 }, { priceChf: 2.123 }, { priceChf: '7.50' },
    { barId: 'node/missing' }, { volumeMl: null }, { volumeMl: 200, serving: 'stange' },
    { drink: 'coffee', coffeeType: 'espresso', volumeMl: 300 }, { drink: 'coffee', coffeeType: 'invented', volumeMl: null },
    { observedAt: '2099-01-01' }, { observedAt: '2026-02-30' }, { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'https://user:password@example.org' }, { name: '' }, { revision: -1 },
  ])('rejects malformed or misleading input %j', patch => expect(() => validateInput({ ...input, ...patch }, [bar])).toThrow());
});
describe('persistent edits', () => {
  it('replaces a scraped price without changing the scraped data, including after scraper refreshes', async () => {
    const store = memoryStore();
    const entry = await savePrice(store, input, data, 'a');
    const updated = applyEntries(beer, [entry], [bar], 'beer');
    expect(updated.bars[0].offers).toHaveLength(1);
    expect(updated.bars[0].offers[0].priceChf).toBe(6.5);
    expect(updated.bars[0].offers[0].confidence).toBe('community');
    expect(bar.offers[0].priceChf).toBe(7);
    expect(applyEntries({ ...beer, bars: [{ ...bar, offers: [{ ...offer, priceChf: 8 }] }] }, [entry], [bar], 'beer').bars[0].offers[0].priceChf).toBe(6.5);
    const edit = await savePrice(store, { ...input, id: entry.id, revision: 1, priceChf: 6 }, data, 'a');
    expect(edit.revision).toBe(2);
    expect((await store.read()).state.history).toEqual([entry]);
    await expect(savePrice(store, { ...input, id: entry.id, revision: 1 }, data, 'a')).rejects.toMatchObject({ status: 409 });
  });
  it('allows adding coffee at a venue previously only in the beer dataset', async () => {
    const entry = await savePrice(memoryStore(), { ...input, drink: 'coffee', name: 'Espresso', coffeeType: 'espresso', volumeMl: null, targetKey: undefined, alcoholFree: true }, data, 'a');
    expect(applyEntries(coffee, [entry], [bar], 'coffee').bars[0].offers[0].coffeeType).toBe('espresso');
    expect(applyEntries(beer, [entry], [bar], 'beer').bars[0].offers).toEqual([offer]);
  });
  it('preserves simultaneous submissions to different offers', async () => {
    const store = memoryStore();
    await Promise.all([
      savePrice(store, input, data, 'a'),
      savePrice(store, { ...input, name: 'Stange', volumeMl: 300, priceChf: 4.5, targetKey: undefined }, data, 'b'),
    ]);
    expect((await store.read()).state.entries).toHaveLength(2);
  });
  it('rejects simultaneous overwrites and duplicate offers', async () => {
    const store = memoryStore();
    const result = await Promise.allSettled([savePrice(store, input, data, 'a'), savePrice(store, { ...input, priceChf: 8 }, data, 'b')]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.read()).state.entries).toHaveLength(1);
    await expect(savePrice(store, { ...input, targetKey: undefined }, data, 'c')).rejects.toMatchObject({ status: 409 });
  });
  it('limits repeated writes across requests, then expires the limit', async () => {
    const store = memoryStore(); const now = Date.now();
    for (let n = 0; n < 20; n++) await savePrice(store, { ...input, name: 'Bier ' + n, targetKey: undefined }, data, 'a', now);
    await expect(savePrice(store, input, data, 'a', now)).rejects.toMatchObject({ status: 429 });
    expect((await store.read()).state.entries).toHaveLength(20);
    await expect(savePrice(store, input, data, 'a', now + 3600001)).resolves.toHaveProperty('revision', 1);
  });
  it('does not accept storage errors as a successful save', async () => {
    const store = memoryStore();
    store.write = async () => { throw new Error('Offline'); };
    await expect(savePrice(store, input, data, 'a')).rejects.toThrow('Offline');
    expect((await store.read()).state.entries).toHaveLength(0);
  });
});
