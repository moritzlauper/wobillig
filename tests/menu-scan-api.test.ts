import { beforeEach, it, expect, vi } from 'vitest';
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
