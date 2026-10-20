import { afterEach, expect, it, vi } from 'vitest';
import { reviewMap } from '../server/map-review';
import { signMapPlace } from '../server/map-places';
import { saveCustomMap, mapFingerprint } from '../server/custom-maps';
import { publicMapSummaries } from '../src/custom-map-data';
import { emptyState, WriteConflict, type State, type Store } from '../server/prices';
import type { Bar, Dataset } from '../src/data';

const mapId = 'd268dbea-93cf-45de-9d17-2b5c74090236';
const bar: Bar = { id: 'node/1', name: 'Dönerhaus', lat: 47.38, lon: 8.53, address: 'Teststrasse 1', postcode: '8004',
  type: 'fast_food', offers: [], website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'unavailable' };
const data: Dataset = { bars: [bar], generatedAt: '', discoveredAt: '', attribution: '' };
function memory() {
  let state: State = emptyState(), version = 0;
  const store: Store = {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
  return store;
}
const create = { action: 'createMap', mapId, name: ' Döner-Map ' };
const input = { action: 'saveMapEntry', mapId, barId: bar.id, product: 'Döner im Taschenbrot', priceChf: 12.5, revision: 0 };

it('persists arbitrary maps and canonical venues, supports edits, and rejects stale prices', async () => {
  const store = memory();
  const map = await saveCustomMap(store, create, {}, 'visitor');
  expect(map.name).toBe('Döner-Map'); expect(map.entries).toEqual([]);
  expect(await saveCustomMap(store, create, {}, 'visitor')).toEqual(map);
  const saved = await saveCustomMap(store, { ...input, venue: { name: 'Forged', lat: 0 } }, { locations: data }, 'visitor');
  expect(saved.entries[0]).toMatchObject({ venue: { id: bar.id, name: bar.name, lat: bar.lat }, priceChf: 12.5, revision: 1 });
  await expect(saveCustomMap(store, input, { locations: data }, 'other')).rejects.toMatchObject({ status: 409 });
  expect((await saveCustomMap(store, { ...input, revision: 1, priceChf: 13 }, { locations: data }, 'other')).entries).toHaveLength(1);
  expect((await store.read()).state.customMaps![0].entries[0].priceChf).toBe(13);
});

it('rejects invalid names, IDs, unknown venues and invalid prices without writing', async () => {
  const store = memory();
  for (const bad of [{ ...create, mapId: '../../private' }, { ...create, name: '' }, { ...create, name: 'x'.repeat(61) }]) {
    await expect(saveCustomMap(store, bad, {}, 'v')).rejects.toMatchObject({ status: 400 });
  }
  await saveCustomMap(store, create, {}, 'v');
  for (const priceChf of [0, -1, 501, NaN, Infinity, 12.345, '12']) {
    await expect(saveCustomMap(store, { ...input, priceChf }, { locations: data }, 'v')).rejects.toMatchObject({ status: 400 });
  }
  await expect(saveCustomMap(store, input, {}, 'v')).rejects.toMatchObject({ status: 400 });
  expect((await store.read()).state.customMaps![0].entries).toEqual([]);
});

it('merges simultaneous additions and preserves existing price data', async () => {
  const store = memory();
  await saveCustomMap(store, create, {}, 'v');
  const datasets = { locations: { ...data, bars: [bar, { ...bar, id: 'node/2' }] } };
  await Promise.all([
    saveCustomMap(store, input, datasets, 'a'),
    saveCustomMap(store, { ...input, barId: 'node/2' }, datasets, 'b'),
  ]);
  const { state } = await store.read();
  expect(state.customMaps![0].entries).toHaveLength(2);
  expect(state.entries).toEqual([]);
});

it('limits new maps per visitor and expires the limit', async () => {
  const store = memory();
  for (let i = 0; i < 5; i++) await saveCustomMap(store, { ...create, mapId: mapId.slice(0, -1) + i }, {}, 'v', 0);
  await expect(saveCustomMap(store, create, {}, 'v', 0)).rejects.toMatchObject({ status: 429 });
  await expect(saveCustomMap(store, create, {}, 'v', 3600001)).resolves.toMatchObject({ id: mapId });
});

it('requires one venue, explicit submission and review before publication', async () => {
  const store = memory();
  const bars = Array.from({ length: 1 }, (_, i) => ({ ...bar, id: `node/${i}` }));
  const datasets = { locations: { ...data, bars } };
  let map = await saveCustomMap(store, create, datasets, 'v');
  expect(publicMapSummaries([map])).toEqual([]);
  await expect(saveCustomMap(store, { action: 'requestMapPublication', mapId }, datasets, 'v')).rejects.toMatchObject({ status: 422 });
  map = await saveCustomMap(store, { ...input, barId: bars[0].id }, datasets, 'v');
  expect(publicMapSummaries([map])).toEqual([]);
  map = await saveCustomMap(store, { action: 'requestMapPublication', mapId }, datasets, 'v');
  expect(map.publication?.status).toBe('pending');
  expect(publicMapSummaries([map])).toEqual([]);
  const fingerprint = mapFingerprint(map);
  await reviewMap(store, mapId, fingerprint, true);
  map = (await store.read()).state.customMaps![0];
  expect(publicMapSummaries([map])).toEqual([{ id: mapId, name: 'Döner-Map', venueCount: 1 }]);
  map = await saveCustomMap(store, { ...input, barId: bars[0].id, revision: 1, priceChf: 14 }, datasets, 'v');
  expect(map.publication).toBeUndefined();
  expect(publicMapSummaries([map])).toEqual([]);
  await expect(reviewMap(store, mapId, fingerprint, true)).rejects.toMatchObject({ status: 409 });
  map = await saveCustomMap(store, { action: 'requestMapPublication', mapId }, datasets, 'v');
  await reviewMap(store, mapId, mapFingerprint(map), false);
  expect(publicMapSummaries((await store.read()).state.customMaps!)).toEqual([]);
  await expect(saveCustomMap(store, { action: 'requestMapPublication', mapId }, datasets, 'v')).rejects.toMatchObject({ status: 422 });
});

afterEach(() => vi.unstubAllEnvs());
it('stores signed OSM shops only in their custom map and can edit them after tokens expire', async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
  const store = memory();
  await saveCustomMap(store, create, {}, 'v', 1000);
  const shop = { ...bar, id: 'node/987', name: 'Drogerie', type: 'chemist' };
  const { token } = signMapPlace(shop, 'zurich', 1000);
  const body = { ...input, barId: shop.id, placeToken: token, product: 'Tampons, 16 Stück', venue: { ...shop, name: 'Forged' } };
  await expect(saveCustomMap(store, body, {}, 'v', 2000, 'bern')).rejects.toMatchObject({ status: 422 });
  let map = await saveCustomMap(store, body, {}, 'v', 2000, 'zurich');
  expect(map.entries[0]).toMatchObject({ venue: { name: 'Drogerie' }, product: 'Tampons, 16 Stück' });
  map = await saveCustomMap(store, { ...body, revision: 1, placeToken: undefined, priceChf: 6 }, {}, 'v', 90000000, 'zurich');
  expect(map.entries[0].priceChf).toBe(6);
  const state = (await store.read()).state;
  expect(state.venues).toBeUndefined();
  expect(state.entries).toEqual([]);
  await expect(saveCustomMap(store, { action: 'setMapVisibility', mapId, published: true }, {}, 'v')).rejects.toMatchObject({ status: 400 });
});
