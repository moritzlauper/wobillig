import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mapPlacesInBounds, searchMapPlaces, signMapPlace, verifiedMapPlace } from '../server/map-places';
import type { Bar } from '../src/data';

beforeEach(() => vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-map-secret'));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const feature = (name: string, id: number, key = 'shop', lon = 8.535, lat = 47.378) => ({
  properties: { name, osm_type: 'N', osm_id: id, osm_key: key, osm_value: 'supermarket', street: 'Teststrasse', housenumber: '3', postcode: '8001' },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});

it('searches all OSM categories, validates coordinates, caches and signs canonical shops', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [
    feature('Migros', 1), feature('Coop', 2), feature('Apotheke', 3, 'amenity'), feature('Drogerie', 4),
    feature('Far away', 5, 'shop', 0, 0), feature('Invalid', 6, 'shop', 999), feature('Duplicate', 1),
  ] }) });
  vi.stubGlobal('fetch', fetcher);
  const places = await searchMapPlaces('Supermarkt test', 'zurich', 1000);
  expect(places).toHaveLength(4);
  const url = fetcher.mock.calls[0][0] as URL;
  expect(url.searchParams.has('osm_tag')).toBe(false);
  expect(url.searchParams.get('bbox')).toBeTruthy();
  expect(verifiedMapPlace(places[1].token, 'zurich', 'node/2', 1001)).toMatchObject({ name: 'Coop', lat: 47.378, address: 'Teststrasse 3' });
  await searchMapPlaces('Supermarkt test', 'zurich', 2000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rejects forged selections, a different city or OSM ID, and expired tokens', () => {
  const venue = { id: 'way/123', name: 'Drogerie', lat: 47.378, lon: 8.535, address: '', postcode: '' } as Bar;
  const { token } = signMapPlace(venue, 'zurich', 1000);
  expect(verifiedMapPlace(token, 'zurich', venue.id, 2000)).toEqual(venue);
  for (const candidate of [token + 'x', token.replace('ey', 'zz'), 'bad']) {
    expect(() => verifiedMapPlace(candidate, 'zurich', venue.id, 2000)).toThrow('erneut suchen');
  }
  expect(() => verifiedMapPlace(token, 'bern', venue.id, 2000)).toThrow();
  expect(() => verifiedMapPlace(token, 'zurich', 'way/999', 2000)).toThrow();
  expect(() => verifiedMapPlace(token, 'zurich', venue.id, 86401000)).toThrow();
});

it('distinguishes unavailable search from no results and does not cache a failure', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
  vi.stubGlobal('fetch', fetcher);
  await expect(searchMapPlaces('Failure test', 'bern', 1000)).rejects.toMatchObject({ status: 503 });
  await expect(searchMapPlaces('Failure test', 'bern', 2000)).resolves.toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(searchMapPlaces('x', 'bern')).resolves.toEqual([]);
  await expect(searchMapPlaces('x'.repeat(161), 'bern')).rejects.toMatchObject({ status: 400 });
});

it('loads and signs nearby OSM points and building centres, reusing rounded viewports', async () => {
  const pharmacy = { type: 'node', id: 123, lat: 47.384, lon: 8.531, tags: { name: 'Apotheke am Limmatplatz', amenity: 'pharmacy', 'addr:street': 'Limmatstrasse', 'addr:housenumber': '118' } };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [pharmacy,
    { type: 'way', id: 456, center: { lat: 47.383, lon: 8.532 }, tags: { name: 'Geschäft', shop: 'supermarket' } },
    { ...pharmacy, id: 789, lon: 0 }, { ...pharmacy, id: 321, lat: '47.384' }, pharmacy,
  ] }) });
  vi.stubGlobal('fetch', fetcher);
  const places = await mapPlacesInBounds('47.381,8.526,47.389,8.539', 'zurich', 1000);
  expect(places).toHaveLength(2);
  expect(verifiedMapPlace(places[0].token, 'zurich', 'node/123', 1001)).toMatchObject({ name: pharmacy.tags.name, address: 'Limmatstrasse 118' });
  expect(places[1].venue).toMatchObject({ id: 'way/456', lat: 47.383 });
  expect(fetcher.mock.calls[0][0].searchParams.get('data')).toContain('(47.38,8.525,47.39,8.54)');
  await mapPlacesInBounds('47.382,8.527,47.388,8.538', 'zurich', 2000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rejects invalid or oversized viewports before querying OSM', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const bounds of ['', '47,8,48,9', '0,0,0.01,0.01', '47.38,8.53,47.37,8.54', '47.38,8.53,47.39,8.54);out;', '47.38,8.53,NaN,8.54']) {
    await expect(mapPlacesInBounds(bounds, 'zurich')).rejects.toMatchObject({ status: 400 });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not cache incomplete OSM viewport results and allows a retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [], remark: 'runtime error: timeout' }) })
    .mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
  vi.stubGlobal('fetch', fetcher);
  await expect(mapPlacesInBounds('47.371,8.521,47.374,8.524', 'zurich', 1000)).rejects.toMatchObject({ status: 503 });
  await expect(mapPlacesInBounds('47.371,8.521,47.374,8.524', 'zurich', 2000)).resolves.toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
