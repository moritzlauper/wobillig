import { describe, expect, it } from 'vitest';
import { validateVenue, type VenueInput } from '../src/venue-contributions';
import { applyEntries, communityVenues, validateInput } from '../src/community';
import { emptyState, savePrice, saveVenue, WriteConflict, type State, type Store } from '../server/prices';
import { createExport } from '../src/export';
import type { Dataset } from '../src/data';

const input: VenueInput = { name: 'Café Test', address: 'Testgasse 12', postcode: '3011', lat: 46.948, lon: 7.447, type: 'cafe', website: 'https://example.org', outdoor: true };
const empty: Dataset = { generatedAt: '', discoveredAt: '', attribution: '', bars: [] };
const data = { beer: empty, coffee: empty };
function memoryStore(): Store {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next: State, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
}
describe('new community venues', () => {
  it.each([{ lat: NaN }, { lat: 0, lon: 0 }, { lon: 8.535, lat: 47.378 }, { name: '' }, { name: 'x'.repeat(101) },
    { postcode: '301' }, { website: 'javascript:alert(1)' }, { website: 'https://user:password@example.org' }, { type: '__proto__' }, { outdoor: 'yes' }])('rejects invalid fields %j', patch => {
    expect(() => validateVenue({ ...input, ...patch }, 'bern')).toThrow();
  });
  it('persists without a price, survives a reload, accepts prices and exports the new venue', async () => {
    const store = memoryStore();
    const { venue } = await saveVenue(store, input, data, 'bern', 'visitor');
    expect(venue.id).toMatch(/^community\//); expect(venue.offers).toEqual([]);
    const { state } = await store.read();
    const venues = communityVenues(data, state.entries, state.venues);
    expect(applyEntries(empty, [], venues, 'coffee').bars).toEqual([venue]);
    expect(createExport('bern', data, [], true, undefined, state.venues).datasets.coffee?.bars).toEqual([venue]);
    const price = validateInput({ barId: venue.id, drink: 'coffee', coffeeType: 'espresso', name: 'Espresso', revision: 0,
      priceChf: 4.5, volumeMl: null, alcoholFree: true, observedAt: '2026-10-19', sourceUrl: '' }, venues, '2026-10-19');
    const entry = await savePrice(store, price, data, 'visitor');
    expect(entry.venue?.id).toBe(venue.id);
    expect(applyEntries(empty, [entry], venues, 'coffee').bars[0].offers[0].priceChf).toBe(4.5);
  });
  it('deduplicates concurrent submissions and retries but allows another branch', async () => {
    const store = memoryStore();
    const results = await Promise.all([saveVenue(store, input, data, 'bern', 'a'), saveVenue(store, { ...input, name: 'Cafe Test' }, data, 'bern', 'b')]);
    expect(results.filter(r => r.created)).toHaveLength(1); expect(results[0].venue.id).toBe(results[1].venue.id);
    expect((await saveVenue(store, input, data, 'bern', 'a')).created).toBe(false);
    expect((await saveVenue(store, { ...input, lat: 46.96, address: 'Andere Gasse 5' }, data, 'bern', 'a')).created).toBe(true);
    expect((await store.read()).state.venues).toHaveLength(2);
  });
  it('recognizes an existing OSM venue and preserves concurrent different additions', async () => {
    const store = memoryStore();
    const { venue } = await saveVenue(store, input, data, 'bern', 'a');
    expect((await saveVenue(memoryStore(), input, { locations: { ...empty, bars: [{ ...venue, id: 'way/123' }] } }, 'bern', 'a')).venue.id).toBe('way/123');
    await Promise.all(['Second', 'Third'].map(name => saveVenue(store, { ...input, name }, data, 'bern', name)));
    expect((await store.read()).state.venues).toHaveLength(3);
  });
  it('limits submissions and reports failed storage instead of a successful save', async () => {
    const store = memoryStore(), now = Date.now();
    for (let n = 0; n < 10; n++) await saveVenue(store, { ...input, name: `Lokal ${n}` }, data, 'bern', 'a', now);
    await expect(saveVenue(store, input, data, 'bern', 'a', now)).rejects.toMatchObject({ status: 429 });
    await expect(saveVenue(store, input, data, 'bern', 'a', now + 3600001)).resolves.toHaveProperty('created', true);
    const broken = memoryStore(); broken.write = async () => { throw new Error('Offline'); };
    await expect(saveVenue(broken, input, data, 'bern', 'a')).rejects.toThrow('Offline');
    expect((await broken.read()).state.venues).toBeUndefined();
  });
});
