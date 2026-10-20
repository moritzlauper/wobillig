import { expect, it } from 'vitest';
import { saveCustomMap } from '../server/custom-maps';
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
