import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, type Store } from '../server/prices';
import { mapFingerprint } from '../server/custom-maps';
import { publicMapSummaries, type CustomMap } from '../src/custom-map-data';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import handler from '../api/map-review';
const map: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: '<img src=x onerror=alert(1)>', createdAt: '2026-10-20',
  publication: { status: 'pending', requestedAt: '2026-10-20', fingerprint: '' },
  entries: Array.from({ length: 1 }, (_, i) => ({ venue: { id: `node/${i}`, name: 'Shop', address: 'Test 1', postcode: '8001', lat: 47.378, lon: 8.535 },
    product: 'Tampons, 16 Stück', priceChf: 4, revision: 1, updatedAt: '2026-10-20' })) };
let state = emptyState();
beforeEach(() => {
  vi.stubEnv('MAP_REVIEW_PASSWORD', 'review-secret'); vi.stubEnv('VERCEL_ENV', 'production');
  state = { ...emptyState(), customMaps: [structuredClone(map)] };
  const store: Store = { read: async () => ({ state: structuredClone(state) }), write: async next => { state = structuredClone(next); } };
  mocks.store.mockReset().mockImplementation((path: string) => path === 'prices/production.json' ? store : { read: async () => ({ state: emptyState() }) });
});
afterEach(() => vi.unstubAllEnvs());
async function request(auth = true, body?: string, origin = 'https://example.org') {
  const req = { method: body ? 'POST' : 'GET', body, headers: { host: 'example.org', origin, 'content-type': 'application/x-www-form-urlencoded',
    authorization: auth ? 'Basic ' + Buffer.from('admin:review-secret').toString('base64') : undefined } } as IncomingMessage & { body?: unknown };
  let output = ''; const headers: Record<string, string> = {};
  const res = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value = '') => { output = value; } } as unknown as ServerResponse;
  await handler(req, res); return { status: res.statusCode, output, headers };
}
it('protects the review queue and escapes submitted content', async () => {
  expect((await request(false)).status).toBe(401);
  expect(mocks.store).not.toHaveBeenCalled();
  const response = await request();
  expect(response.status).toBe(200); expect(response.output).toContain('Tampons, 16 Stück');
  expect(response.output).not.toContain('<img src=x'); expect(response.output).toContain('&lt;img');
  expect(response.headers['Cache-Control']).toBe('private, no-store');
  expect(response.headers['Referrer-Policy']).toBe('same-origin');
});
it.each(['null', 'not-a-url', 'https://other.example'])('rejects invalid origin %s without accessing storage', async origin => {
  const body = new URLSearchParams({ city: 'zurich', id: map.id, fingerprint: mapFingerprint(map), decision: 'reject' }).toString();
  expect((await request(true, body, origin)).status).toBe(403);
  expect(mocks.store).not.toHaveBeenCalled();
  expect(state.customMaps![0].publication?.status).toBe('pending');
});
it('publishes only an authenticated, same-origin decision for the reviewed snapshot', async () => {
  const body = new URLSearchParams({ city: 'zurich', id: map.id, fingerprint: mapFingerprint(map), decision: 'approve' }).toString();
  expect((await request(false, body)).status).toBe(401);
  expect((await request(true, body, 'https://other.example')).status).toBe(403);
  expect(publicMapSummaries(state.customMaps!)).toEqual([]);
  const approved = await request(true, body);
  expect(approved.status).toBe(303);
  expect(approved.headers.Location).toBe('/output/price-review/production#map-review');
  expect(state.customMaps![0].publishedAt).toBeTruthy();
  expect(publicMapSummaries(state.customMaps!)).toHaveLength(1);
  expect((await request(true, body)).status).toBe(409);
});
it('refuses approval after changes and keeps rejected maps unlisted', async () => {
  const body = { city: 'zurich', id: map.id, fingerprint: mapFingerprint(map), decision: 'approve' };
  state.customMaps![0].entries[0].priceChf = 7;
  expect((await request(true, new URLSearchParams(body).toString())).status).toBe(409);
  const rejected = await request(true, new URLSearchParams({ ...body, fingerprint: mapFingerprint(state.customMaps![0]), decision: 'reject' }).toString());
  expect(rejected.status).toBe(303);
  expect(rejected.headers.Location).toBe('/output/price-review/production#map-review');
  expect(state.customMaps![0].publishedAt).toBeUndefined();
  expect(publicMapSummaries(state.customMaps!)).toEqual([]);
  expect(state.customMaps![0].publication?.status).toBe('rejected');
});
