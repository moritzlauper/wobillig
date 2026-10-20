import { describe, expect, it } from 'vitest';
import { communityVenues, applyEntries } from '../src/community';
import type { Bar, Dataset } from '../src/data';
import { createExport } from '../src/export';
import { validateVenueCorrection } from '../src/venue-corrections';
import { saveVenueCorrection } from '../server/venue-corrections';
import { emptyState, saveVenue, WriteConflict, type State, type Store } from '../server/prices';

const bar: Bar = { id: 'node/1', name: 'Testcafé', address: '', postcode: '', website: 'https://wrong.example/',
  lat: 46.948, lon: 7.447, outdoor: false, type: 'cafe', openingHours: null, checkedAt: null, scrapeStatus: 'ok',
  offers: [{ name: 'Espresso', coffeeType: 'espresso', priceChf: 4, volumeMl: null, alcoholFree: true,
    sourceUrl: 'https://menu.example/', observedAt: '2026-10-19', confidence: 'automatic', evidence: '' }] };
const dataset: Dataset = { bars: [bar], generatedAt: '', discoveredAt: '', attribution: '' };
const data = { coffee: dataset, beer: { ...dataset, bars: [] } };
const input = { barId: bar.id, revision: 0, changes: { website: 'https://correct.example' } };
function memoryStore(): Store {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next: State, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
}

describe('venue corrections', () => {
  it('changes a website on a sparse existing venue immediately, preserving IDs and prices across refreshes and exports', async () => {
    const store = memoryStore();
    const { correction } = await saveVenueCorrection(store, input, data, 'visitor');
    expect(correction.changes.website).toBe('https://correct.example/');
    const { state } = await store.read();
    expect(state.venues).toBeUndefined();
    expect(state.entries).toEqual([]);
    expect(state.venueCorrectionHistory?.[0].before.website).toBe(bar.website);
    const refreshed = { ...dataset, bars: [{ ...bar, name: 'New scraper name', offers: [{ ...bar.offers[0], priceChf: 4.5 }] }] };
    const venues = communityVenues({ coffee: refreshed }, [], [], state.venueCorrections);
    const merged = applyEntries(refreshed, [], venues, 'coffee', state.venueCorrections);
    expect(merged.bars[0]).toMatchObject({ id: bar.id, name: 'New scraper name', website: 'https://correct.example/' });
    expect(merged.bars[0].offers[0]).toMatchObject({ priceChf: 4.5, sourceUrl: 'https://menu.example/' });
    expect(createExport('bern', { coffee: refreshed }, [], true, undefined, [], state.venueCorrections).datasets.coffee).toEqual(merged);
  });
  it('supports removing a website and subsequent edits without discarding earlier corrections', async () => {
    const store = memoryStore();
    await saveVenueCorrection(store, { ...input, changes: { website: '' } }, data, 'visitor');
    const { correction } = await saveVenueCorrection(store, { ...input, revision: 1, changes: { name: 'Renamed café', address: 'Gasse 1', postcode: '3011' } }, data, 'visitor');
    expect(correction).toMatchObject({ revision: 2, changes: { website: null, name: 'Renamed café' } });
    expect(communityVenues(data, [], [], [correction])[0].website).toBeNull();
  });
  it('supports community and catalogue-only venues and rejects an ID absent from this city', async () => {
    const store = memoryStore();
    const { venue } = await saveVenue(store, { ...bar, name: 'Community', address: 'Gasse 1', postcode: '3011' }, data, 'bern', 'visitor');
    await expect(saveVenueCorrection(store, { ...input, barId: venue.id }, data, 'visitor')).resolves.toHaveProperty('correction.barId', venue.id);
    await expect(saveVenueCorrection(memoryStore(), input, { locations: dataset }, 'visitor')).resolves.toHaveProperty('correction.barId', bar.id);
    await expect(saveVenueCorrection(memoryStore(), input, { coffee: { ...dataset, bars: [] } }, 'visitor')).rejects.toMatchObject({ status: 404 });
  });
  it('deduplicates retries and rejects stale conflicting updates', async () => {
    const store = memoryStore();
    const first = await saveVenueCorrection(store, input, data, 'visitor');
    expect(await saveVenueCorrection(store, input, data, 'visitor')).toEqual(first);
    await expect(saveVenueCorrection(store, { ...input, changes: { website: 'https://other.example' } }, data, 'visitor')).rejects.toMatchObject({ status: 409 });
    expect((await store.read()).state.venueCorrectionHistory).toHaveLength(1);
  });
  it('preserves simultaneous changes to different venues and detects same-venue races', async () => {
    const store = memoryStore();
    const two = { coffee: { ...dataset, bars: [bar, { ...bar, id: 'node/2' }] } };
    await Promise.all([input, { ...input, barId: 'node/2' }].map(value => saveVenueCorrection(store, value, two, 'visitor')));
    expect((await store.read()).state.venueCorrections).toHaveLength(2);
    const race = await Promise.allSettled(['A', 'B'].map(name => saveVenueCorrection(store, { ...input, revision: 1, changes: { name } }, two, 'visitor')));
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  });
  it.each([{ changes: {} }, { changes: { website: 'javascript:alert(1)' } }, { changes: { website: 'https://user:pass@example.org' } },
    { changes: { website: 'https://example.org/\nfoo' } }, { changes: { name: '' } }, { changes: { address: 'x'.repeat(161) } },
    { changes: { postcode: '123' } }, { changes: { id: 'node/2' } }, { changes: { offers: [] } }, { revision: -1 }])('rejects invalid corrections %j', patch => {
    expect(() => validateVenueCorrection({ ...input, ...patch })).toThrow();
  });
  it('limits writes and propagates storage failures without claiming success', async () => {
    const store = memoryStore(), now = Date.now();
    for (let revision = 0; revision < 20; revision++) await saveVenueCorrection(store, { ...input, revision, changes: { name: `Name ${revision}` } }, data, 'visitor', now);
    await expect(saveVenueCorrection(store, { ...input, revision: 20 }, data, 'visitor', now)).rejects.toMatchObject({ status: 429 });
    await expect(saveVenueCorrection(store, { ...input, revision: 20 }, data, 'visitor', now + 3600001)).resolves.toHaveProperty('correction.revision', 21);
    const broken = memoryStore(); broken.write = async () => { throw new Error('Offline'); };
    await expect(saveVenueCorrection(broken, input, data, 'visitor')).rejects.toThrow('Offline');
    expect((await broken.read()).state.venueCorrections).toBeUndefined();
  });
});
