import { beforeEach, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, WriteConflict, type State, type Store } from '../server/prices';
const mocks = vi.hoisted(() => ({ blobStore: vi.fn(), readMenu: vi.fn() }));
vi.mock('../server/prices.js', async importOriginal => ({ ...await importOriginal<object>(), blobStore: mocks.blobStore }));
vi.mock('../server/menu-ocr.js', async importOriginal => ({ ...await importOriginal<object>(), readMenu: mocks.readMenu }));
import handler from '../api/scan-menu';
let store: Store;
const photo = { barId: 'node/582264861', image: { mediaType: 'image/jpeg', data: '/9j/2Q==' } };
async function request(body: unknown = photo, patch: object = {}) {
  const req = { url: '/api/scan-menu?city=zurich', method: 'POST', body,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, ...patch } as IncomingMessage & { body?: unknown };
  let data: any;
  const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { data = JSON.parse(value); } } as unknown as ServerResponse;
  await handler(req, res); return { status: res.statusCode, data };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY', 'test'); vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test'); vi.stubEnv('VERCEL_ENV', 'production');
  let state = emptyState(), version = 0;
  store = { async read() { return { state: structuredClone(state), etag: String(version) }; }, async write(next: State, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; } };
  mocks.blobStore.mockReturnValue(store);
  mocks.readMenu.mockResolvedValue({ parsed: { menu: true, wrongVenue: false, currency: 'CHF', rows: [{ name: 'Sprint', category: 'beer', sizes: ['3dl', '5dl'], prices: ['5.20', '7.90'], beerType: 'draft', alcoholFree: false, clear: true }] } });
});
it('uploads a menu and returns both committed prices without additional fields', async () => {
  const result = await request(); expect(result.status).toBe(200);
  expect(result.data).toMatchObject({ added: 2, unchanged: 0, conflicts: 0 });
  expect(result.data.entries.map((e: any) => [e.barId, e.offer.priceChf, e.offer.volumeMl])).toEqual([['node/582264861', 5.2, 300], ['node/582264861', 7.9, 500]]);
  expect(mocks.blobStore).toHaveBeenCalledWith('prices/production.json');
  expect((await request()).data.entries).toEqual(result.data.entries);
  expect(mocks.readMenu).toHaveBeenCalledTimes(1);
});
it('stores 15 menu prices in one upload even when the manual editing quota is exhausted', async () => {
  const { state, etag } = await store.read();
  const visitor = createHmac('sha256', 'test').update(`${new Date().toISOString().slice(0, 10)}:127.0.0.1`).digest('hex');
  state.limits[visitor] = { count: 20, expires: Date.now() + 3600000 };
  state.priceCooldowns = { 'ip:exhausted': Array.from({ length: 5 }, (_, i) => ({ id: String(i), at: Date.now() })) };
  const quota = structuredClone(state.priceCooldowns);
  await store.write(state, etag);
  mocks.readMenu.mockResolvedValue({ parsed: { menu: true, wrongVenue: false, currency: 'CHF',
    rows: Array.from({ length: 15 }, (_, i) => ({
      name: `Testbier ${i + 1}`, category: 'beer', sizes: ['3dl'], prices: ['5.20'],
      beerType: 'draft', alcoholFree: false, clear: true,
    })),
  } });
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.data.added).toBe(15);
  expect(result.data.entries).toHaveLength(15);
  const saved = (await store.read()).state;
  expect(saved.entries).toHaveLength(15);
  expect(saved.priceCooldowns).toEqual(quota);
  expect(saved.limits[visitor].count).toBe(20);
  expect(mocks.blobStore.mock.calls.every(([path]) => path === 'prices/production.json')).toBe(true);
  expect(Object.entries(saved.limits).filter(([key]) => key.startsWith('scan:') && key !== 'scan:daily').map(([, value]) => value.count)).toEqual([1]);
});
it('rejects a clearly wrong restaurant with a specific message and saves no prices', async () => {
  mocks.readMenu.mockResolvedValue({ parsed: { menu: true, wrongVenue: true, currency: 'CHF', rows: [] } });
  const result = await request();
  expect(result.status).toBe(422);
  expect(result.data.error).toContain('anderen Lokal');
  expect((await store.read()).state.entries).toEqual([]);
  expect(Object.values((await store.read()).state.menuScans!)[0].status).toBe('failed');
});
it('rejects foreign origins, unsupported files and non-existent city venues before OCR', async () => {
  expect((await request(photo, { headers: { host: 'example.org', origin: 'https://other.example', 'content-type': 'application/json' } })).status).toBe(403);
  expect((await request({ ...photo, image: { mediaType: 'image/jpeg', data: 'bad' } })).status).toBe(400);
  expect((await request(photo, { url: '/api/scan-menu?city=bern' })).status).toBe(400);
  expect((await request(photo, { url: '/api/scan-menu?city=../../private' })).status).toBe(400);
  expect(mocks.readMenu).not.toHaveBeenCalled();
});
it('rejects oversize uploads before OCR or storage', async () => {
  expect((await request(photo, { headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', 'content-length': '3000000' } })).status).toBe(413);
  expect(mocks.blobStore).not.toHaveBeenCalled(); expect(mocks.readMenu).not.toHaveBeenCalled();
});
it('ignores injected prices and venue coordinates in the request', async () => {
  const result = await request({ ...photo, prices: [{ priceChf: 1 }], venue: { name: 'Fake' } });
  expect(result.data.entries[0].offer.priceChf).toBe(5.2);
  expect(result.data.entries[0].venue.name).toBe('Mars Bar');
});
it('leaves the store unchanged for unreadable photos and does not charge another call on retry', async () => {
  mocks.readMenu.mockResolvedValue({ parsed: { menu: false, wrongVenue: false, currency: 'unspecified', rows: [] } });
  expect((await request()).status).toBe(422); expect((await request()).status).toBe(422);
  expect((await store.read()).state.entries).toEqual([]); expect(mocks.readMenu).toHaveBeenCalledTimes(1);
});
it('handles missing API configuration without sending the photo or claiming success', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', ''); expect((await request()).status).toBe(503); expect(mocks.readMenu).not.toHaveBeenCalled();
});

it('allows scanning a newly contributed venue that is absent from the OSM catalogue', async () => {
  const { state, etag } = await store.read();
  state.venues = [{ id: 'community/new', name: 'New café', lat: 47.378, lon: 8.535, type: 'cafe', address: 'Test 1', postcode: '8001', website: null,
    openingHours: null, outdoor: false, offers: [], scrapeStatus: 'community', checkedAt: null }];
  await store.write(state, etag);
  const result = await request({ ...photo, barId: 'community/new' });
  expect(result.status).toBe(200); expect(result.data.entries[0].venue.name).toBe('New café');
});

it('retries a completed targeted correction without re-running OCR or failing on the old revision', async () => {
  const first = await request();
  const entry = first.data.entries[0];
  const edit = { id: entry.id, revision: entry.revision, targetKey: entry.targetKey, drink: 'beer' };
  mocks.readMenu.mockResolvedValue({ parsed: { menu: true, wrongVenue: false, currency: 'CHF', rows: [{ name: 'Sprint', category: 'beer', sizes: ['3dl'], prices: ['9.20'], beerType: 'draft', alcoholFree: false, clear: true }] } });
  const corrected = await request({ ...photo, edit });
  expect(corrected.status).toBe(200);
  expect(corrected.data.updated).toBe(1);
  expect(corrected.data.entries[0].offer.priceChf).toBe(9.2);
  expect((await request({ ...photo, edit })).data).toEqual(corrected.data);
  expect(mocks.readMenu).toHaveBeenCalledTimes(2);
});
