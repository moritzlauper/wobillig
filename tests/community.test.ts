import { describe, it, expect } from 'vitest';
import { allVenues, applyEntries, offerKey, validateInput, type PriceInput } from '../src/community';
import { emptyState, savePrice, WriteConflict, type State, type Store } from '../server/prices';
import { filterBars, type Bar, type Dataset, type Offer, type Filters } from '../src/data';
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
    for (const coffeeType of ['matcha_latte']) {
      expect(validateInput({ ...input, drink: 'coffee', coffeeType, volumeMl: null }, [bar]).coffeeType).toBe(coffeeType);
    }
    expect(validateInput({ ...input, volumeMl: null, serving: 'stange' }, [bar]).volumeMl).toBeNull();
  });
  it.each([
    { priceChf: NaN }, { priceChf: 0 }, { priceChf: 2.123 }, { priceChf: '7.50' },
    { barId: 'node/missing' }, { volumeMl: null }, { volumeMl: 200, serving: 'stange' },
    { drink: 'coffee', coffeeType: 'espresso', volumeMl: 300 }, { drink: 'coffee', coffeeType: 'invented', volumeMl: null }, { drink: 'coffee', coffeeType: 'matcha', volumeMl: null },
    { observedAt: '2099-01-01' }, { observedAt: '2026-02-30' }, { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'https://user:password@example.org' }, { name: '' }, { revision: -1 },
  ])('rejects malformed or misleading input %j', patch => expect(() => validateInput({ ...input, ...patch }, [bar])).toThrow());
});
describe('persistent edits', () => {
  it('hides coffee-only cafés from beer results until a beer price is contributed', async () => {
    const pluesch: Bar = { ...bar, id: 'node/364410129', name: 'Plüsch', type: 'cafe', offers: [{ ...offer, name: 'Espresso', coffeeType: 'espresso', volumeMl: null }] };
    const coffeeData = { ...coffee, bars: [pluesch] };
    const venues = allVenues({ beer, coffee: coffeeData });
    const result = applyEntries(beer, [], venues, 'beer');
    const filters: Filters = { drink: 'beer', query: 'Plüsch', max: 15, volume: '500', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
    expect(filterBars(result.bars, filters)).toEqual([]);
    expect(result.bars.find(b => b.id === pluesch.id)?.offers).toEqual([]);
    expect(filterBars(result.bars, { ...filters, unknown: false })).toEqual([]);
    const coffeeResult = applyEntries(coffeeData, [], venues, 'coffee');
    expect(coffeeResult.bars.find(b => b.id === bar.id)?.offers).toEqual([]);
    expect(coffeeResult.bars.find(b => b.id === pluesch.id)?.offers).toEqual(pluesch.offers);
    expect(result.bars.find(b => b.id === bar.id)?.offers).toEqual(bar.offers);
    const entry = await savePrice(memoryStore(), { ...input, barId: pluesch.id, targetKey: undefined }, { beer, coffee: coffeeData }, 'a');
    const withBeer = applyEntries(beer, [entry], venues, 'beer');
    expect(filterBars(withBeer.bars, filters).map(b => b.id)).toEqual([pluesch.id]);
  });
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

describe('shared Ausschankart', () => {
  it('validates and persists the type, including explicit unknown', async () => {
    const typed = validateInput({ ...input, beerType: 'draft' }, [bar]);
    expect((await savePrice(memoryStore(), typed, data, 'a')).offer.beerType).toBe('draft');
    expect(validateInput(input, [bar]).beerType).toBe('unknown');
    for (const patch of [{ beerType: 'invented' }, { beerType: 'bottle', serving: 'stange', volumeMl: 300 }, { drink: 'coffee', coffeeType: 'espresso', volumeMl: null, beerType: 'draft' }]) {
      expect(() => validateInput({ ...input, ...patch }, [bar])).toThrow();
    }
  });
  it('keeps identical draft and bottled products independently editable', async () => {
    const draft = { ...offer, beerType: 'draft' as const }, bottle = { ...offer, beerType: 'bottle' as const };
    const dataset = { ...beer, bars: [{ ...bar, offers: [draft, bottle] }] };
    const store = memoryStore();
    const a = await savePrice(store, { ...input, beerType: 'draft', targetKey: offerKey(draft) }, { ...data, beer: dataset }, 'a');
    const c = await savePrice(store, { ...input, beerType: 'bottle', targetKey: offerKey(bottle), priceChf: 5 }, { ...data, beer: dataset }, 'b');
    const offers = applyEntries(dataset, [a, c], [bar], 'beer').bars[0].offers;
    expect(offers.map(o => [o.beerType, o.priceChf])).toEqual([['draft', 6.5], ['bottle', 5]]);
  });
  it('retains legacy corrections when the scraper learns the type, without conflating two types', async () => {
    const entry = await savePrice(memoryStore(), input, data, 'a');
    const draft = { ...offer, beerType: 'draft' as const }, bottle = { ...offer, beerType: 'bottle' as const };
    const learned = { ...beer, bars: [{ ...bar, offers: [draft] }] };
    const fixed = applyEntries(learned, [entry], [bar], 'beer').bars[0].offers;
    expect(fixed).toHaveLength(1); expect(fixed[0].beerType).toBe('draft');
    const ambiguous = applyEntries({ ...beer, bars: [{ ...bar, offers: [draft, bottle] }] }, [entry], [bar], 'beer').bars[0].offers;
    expect(ambiguous.filter(o => o.confidence === 'automatic')).toHaveLength(2);
  });
});

it('preserves an estimate for legacy edits but lets a visitor override it', async () => {
  const estimated: Offer = { ...offer, beerType: 'unknown', beerTypeEstimate: { type: 'draft', reason: 'Glasgrössen', method: 'ai' } };
  expect(offerKey(estimated)).toBe(offerKey(offer));
  const dataset = { ...beer, bars: [{ ...bar, offers: [estimated] }] };
  const legacy = await savePrice(memoryStore(), input, data, 'a');
  expect(applyEntries(dataset, [legacy], [bar], 'beer').bars[0].offers[0].beerTypeEstimate?.type).toBe('draft');
  const correction = await savePrice(memoryStore(), { ...input, beerType: 'bottle' }, data, 'b');
  const corrected = applyEntries(dataset, [correction], [bar], 'beer').bars[0].offers[0];
  expect(corrected.beerType).toBe('bottle');
  expect(corrected.beerTypeEstimate).toBeUndefined();
});

it.each(['Panash', 'Stange Panaché', 'Calanda Radler'])('rejects beer mix entry %s', name => {
  expect(() => validateInput({ ...input, name, beerType: 'draft' }, [bar])).toThrow('Biermischgetränke');
});
