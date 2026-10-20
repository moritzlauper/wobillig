import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { searchMapPlaces, signMapPlace, verifiedMapPlace } from '../server/map-places';
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
