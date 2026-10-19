import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { googleMapsLink, withKnownAddress, locationAtPosition, nearbyLocations, selectableLocations } from '../src/locations';
import { allVenues, communityVenues, applyEntries, validateInput, type PriceInput } from '../src/community';
import { emptyState, savePrice, WriteConflict, type State } from '../server/prices';
import type { Dataset } from '../src/data';
const catalogue = JSON.parse(readFileSync('public/data/locations.json', 'utf8')) as Dataset;
const roi = catalogue.bars.find(b => b.name === 'Roi-Et')!;
const empty: Dataset = { generatedAt: '', discoveredAt: '', attribution: '', bars: [] };
const data = { beer: empty, coffee: empty, pizza: empty, locations: { ...empty, bars: [roi] } };
const input: PriceInput = { barId: roi.id, drink: 'beer', revision: 0, name: 'Lager', priceChf: 6, volumeMl: 300, beerType: 'draft', alcoholFree: false, observedAt: '2026-10-15', sourceUrl: '' };
function memoryStore() {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next: State, etag?: string) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
}
describe('map locations', () => {
  it('preserves known addresses through catalogue, category and community merges', () => {
    const addressed = { ...roi, address: 'Testgasse 4', postcode: '8004' };
    const sparse = { ...roi, address: '', postcode: '' };
    expect(selectableLocations([sparse], [addressed])[0]).toMatchObject({ address: addressed.address, postcode: addressed.postcode });
    const datasets = { locations: { ...empty, bars: [addressed] }, coffee: { ...empty, bars: [sparse] } };
    const venues = communityVenues(datasets, []);
    expect(venues[0].address).toBe(addressed.address);
    for (const drink of ['coffee', 'beer', 'pizza'] as const) {
      expect(applyEntries(datasets.coffee, [], venues, drink).bars[0].address).toBe(addressed.address);
    }
    expect(withKnownAddress({ ...roi, address: 'New address 2' }, roi).address).toBe('New address 2');
    expect(withKnownAddress(sparse, { ...roi, id: 'another-venue' }).address).toBe('');
  });
  it('links to the named venue and address, or coordinates when no address is known', () => {
    const link = new URL(googleMapsLink({ ...roi, name: 'Café & Bar', address: 'Testgasse 4', postcode: '8004' }, 'Zürich'));
    expect(link.origin).toBe('https://www.google.com');
    expect(link.searchParams.get('api')).toBe('1');
    expect(link.searchParams.get('query')).toBe('Café & Bar, Testgasse 4, 8004, Zürich, Schweiz');
    expect(new URL(googleMapsLink({ ...roi, address: '' }, 'Zürich')).searchParams.get('query')).toBe(`${roi.lat},${roi.lon}`);
  });
  const position: [number, number] = [47.37, 8.54];
  const atMetres = (metres: number, id = 'nearby') => ({ ...roi, id, lat: position[0] + metres / 6371000 * 180 / Math.PI, lon: position[1] });
  it('opens only an immediately nearby venue with an accurate fix', () => {
    const here = atMetres(5);
    expect(locationAtPosition([atMetres(70, 'other'), here], position, 8)).toBe(here);
    expect(locationAtPosition([atMetres(16)], position, 5)).toBeUndefined();
    expect(locationAtPosition([atMetres(10)], position, 20)).toBeUndefined();
    expect(locationAtPosition([], position, 5)).toBeUndefined();
  });
  it.each([0, -1, 21, 100, NaN, Infinity])('does not auto-open for unreliable accuracy %s', accuracy => {
    expect(locationAtPosition([atMetres(0)], position, accuracy)).toBeUndefined();
  });
  it('leaves adjacent and overlapping venues to the visitor', () => {
    expect(locationAtPosition([atMetres(0), atMetres(0, 'other')], position, 5)).toBeUndefined();
    expect(locationAtPosition([atMetres(2), atMetres(18, 'other')], position, 5)).toBeUndefined();
    expect(locationAtPosition([atMetres(2), atMetres(30, 'other')], position, 15)).toBeUndefined();
    const here = atMetres(2);
    expect(locationAtPosition([here, atMetres(40, 'other')], position, 15)).toBe(here);
    expect(locationAtPosition([here, here], position, 5)).toBe(here);
  });
  it('rejects invalid coordinates', () => {
    for (const point of [[NaN, 8], [91, 8], [47, 181]] as [number, number][]) {
      expect(locationAtPosition([atMetres(0)], point, 5)).toBeUndefined();
    }
  });
  it('contains the named locations from the map without invented prices', () => {
    for (const name of ['Kokoro', 'Roi-Et', 'Piccolo Giardino', 'Phuket Thai Food', 'Restaurant Schnupf / Rangierbahnhof']) {
      expect(catalogue.bars.find(b => b.name === name)).toMatchObject({ offers: [], lat: expect.any(Number), lon: expect.any(Number) });
    }
    expect(catalogue.bars.every(b => b.offers.length === 0)).toBe(true);
    expect(new Set(catalogue.bars.map(b => b.id)).size).toBe(catalogue.bars.length);
    expect(communityVenues({ beer: empty, coffee: empty, pizza: empty }, [])).toEqual([]);
  });
  it('offers nearby choices in distance order and excludes distant locations', () => {
    const a = { ...roi, id: 'node/1', lat: 10 }, b = { ...roi, id: 'node/2', lat: 50 }, c = { ...roi, id: 'node/3', lat: 200 };
    expect(nearbyLocations([b, c, a], { x: 0, y: 0 }, bar => ({ x: bar.lat, y: 0 })).map(b => b.id)).toEqual(['node/1', 'node/2']);
    expect(nearbyLocations([a], { x: 500, y: 0 }, bar => ({ x: bar.lat, y: 0 }))).toEqual([]);
    expect(selectableLocations([{ ...roi, name: 'Updated' }], [roi])).toHaveLength(1);
    expect(selectableLocations([{ ...roi, name: 'Updated' }], [roi])[0].name).toBe('Updated');
    expect(allVenues({ beer: { ...empty, bars: [{ ...roi, name: 'Canonical' }] }, locations: { ...empty, bars: [roi] } })[0].name).toBe('Canonical');
  });
  it('rejects arbitrary client-supplied names and coordinates as new locations', () => {
    expect(() => validateInput({ ...input, barId: 'node/999999999999', venue: { ...roi, name: 'Fake', lat: 0 } }, allVenues(data))).toThrow();
    expect(validateInput({ ...input, venue: { ...roi, name: 'Fake', lat: 0 } }, allVenues(data))).not.toHaveProperty('venue');
  });
  it.each(['beer', 'coffee', 'pizza'] as const)('persists a new location with a %s price and restores it after reload', async drink => {
    const patch = drink === 'beer' ? {} : drink === 'coffee' ? { name: 'Espresso', volumeMl: null, beerType: undefined, coffeeType: 'espresso' } : { name: 'Pizza Margherita', volumeMl: null, beerType: undefined, pizzaType: 'margherita' };
    const value = validateInput({ ...input, ...patch, drink }, allVenues(data));
    const store = memoryStore();
    await savePrice(store, value, data, 'visitor');
    const entries = (await store.read()).state.entries;
    expect(entries[0].venue).toMatchObject({ id: roi.id, name: roi.name, lat: roi.lat, lon: roi.lon, offers: [] });
    const venues = communityVenues({ beer: empty, coffee: empty, pizza: empty }, entries);
    const result = applyEntries(empty, entries, venues, drink);
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].offers[0]).toMatchObject({ priceChf: 6, confidence: 'community' });
    expect(communityVenues({ beer: { ...empty, bars: [{ ...roi, name: 'Canonical' }] } }, entries)[0].name).toBe('Canonical');
    // Existing entries can still be corrected if a later catalogue omits the POI.
    const edit = validateInput({ ...value, id: entries[0].id, revision: 1, priceChf: 7 }, venues);
    await savePrice(store, edit, { beer: empty, coffee: empty, pizza: empty }, 'visitor');
    expect((await store.read()).state.entries[0].offer.priceChf).toBe(7);
  });
  it('keeps simultaneous beer and pizza entries at the same new location', async () => {
    const store = memoryStore();
    await Promise.all([
      savePrice(store, validateInput(input, allVenues(data)), data, 'a'),
      savePrice(store, validateInput({ ...input, drink: 'pizza', name: 'Margherita', pizzaType: 'margherita', beerType: undefined, volumeMl: null }, allVenues(data)), data, 'b'),
    ]);
    const entries = (await store.read()).state.entries;
    expect(entries).toHaveLength(2);
    expect(communityVenues({}, entries)).toHaveLength(1);
  });
});
