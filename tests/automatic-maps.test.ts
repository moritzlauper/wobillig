import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, WriteConflict, type Store } from '../server/prices';
import { automaticMapReviewCards } from '../server/automatic-map-review';
import { publicMapSummaries } from '../src/custom-map-data';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import prices from '../api/prices';
import review from '../api/map-review';
const id = 'd268dbea-93cf-45de-9d17-2b5c74090236';
const otherId = 'd268dbea-93cf-45de-9d17-2b5c74090237';
const suggestion = { action: 'requestAutomaticMap', mapId: id, name: 'Coop Aktionen Zürich',
  sourceUrl: 'https://www.coop.ch/de/aktionen/alle-aktionen/c/m_1111', description: 'Kaffeeaktionen' };
let stores: Map<string, Store>;
beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret'); vi.stubEnv('MAP_REVIEW_PASSWORD', 'review-secret'); vi.stubEnv('VERCEL_ENV', 'production');
  stores = new Map();
  mocks.store.mockReset().mockImplementation((path: string) => {
    if (!stores.has(path)) {
      let state = emptyState(), version = 0;
      stores.set(path, { read: async () => ({ state: structuredClone(state), etag: String(version) }), write: async (next, etag) => {
        if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++;
      } });
    }
    return stores.get(path);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function request(body?: object, options: { admin?: boolean; auth?: boolean; origin?: string; query?: string; ip?: string; cookie?: string } = {}) {
  const admin = options.admin;
  const req = { method: body ? 'POST' : 'GET', url: `/api/prices?${options.query || 'city=zurich'}`,
    body: admin && body ? new URLSearchParams(body as Record<string, string>).toString() : body,
    headers: { host: 'example.org', origin: options.origin || 'https://example.org', cookie: options.cookie,
      authorization: options.auth ? 'Basic ' + Buffer.from('admin:review-secret').toString('base64') : undefined,
      'content-type': admin ? 'application/x-www-form-urlencoded' : 'application/json' }, socket: { remoteAddress: options.ip || 'ip-1' } } as IncomingMessage & { body?: unknown };
  const headers: Record<string, string> = {}; let output = '';
  const res = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value = '') => { output = value; } } as unknown as ServerResponse;
  await (admin ? review : prices)(req, res);
  return { status: res.statusCode, headers, output, data: admin ? undefined : JSON.parse(output) };
}
it('stores requests without fetching their URLs, deduplicates retries and shares creation quotas with manual maps', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const first = await request({ ...suggestion, automatic: { status: 'active' } });
  expect(first.status).toBe(200); expect(first.data.map.automatic).toMatchObject({ status: 'requested', revision: 1 });
  const cookie = first.headers['Set-Cookie'].split(';')[0];
  expect((await request(suggestion)).status).toBe(200);
  const duplicate = await request({ ...suggestion, mapId: otherId, name: 'Coop Kaffee', description: ' KAFFEEAKTIONEN ', sourceUrl: suggestion.sourceUrl + '#offers' });
  expect(duplicate.status).toBe(200); expect(duplicate.data.map.id).toBe(id);
  expect((await request({ action: 'createMap', mapId: otherId, name: 'Map' }, { query: 'city=bern', ip: 'ip-2', cookie })).status).toBe(429);
  expect((await request({ ...suggestion, mapId: otherId, description: 'Andere Angebote' })).status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
  expect(publicMapSummaries((await stores.get('prices/production.json')!.read()).state.customMaps!)).toEqual([]);
});
it('rejects unsafe URLs and oversized descriptions without reserving the daily slot', async () => {
  for (const sourceUrl of ['javascript:alert(1)', 'http://example.org', 'https://user:password@example.org', 'not a url']) {
    expect((await request({ ...suggestion, sourceUrl })).status).toBe(400);
  }
  expect((await request({ ...suggestion, description: 'x'.repeat(601) })).status).toBe(400);
  const created = await request({ ...suggestion, description: 'Kaffeeaktionen\nIn Zürich' });
  expect(created.status).toBe(200); expect(created.data.map.automatic.description).toContain('\n');
  expect((await request({ ...suggestion, action: 'createMap' })).status).toBe(409);
  expect((await request({ action: 'requestMapPublication', mapId: id })).status).toBe(409);
  expect((await request({ action: 'saveMapEntry', mapId: id, product: 'Coffee', priceChf: 5, revision: 0 })).status).toBe(409);
});
it('requires an authenticated same-origin review and rejects stale or unsupported decisions', async () => {
  await request(suggestion);
  const body = { kind: 'automatic', city: 'zurich', id, revision: '1', decision: 'blocked', note: 'Quelle blockiert automatische Abrufe.' };
  expect((await request(body, { admin: true })).status).toBe(401);
  expect((await request(body, { admin: true, auth: true, origin: 'https://other.example' })).status).toBe(403);
  expect((await request({ ...body, decision: 'active' }, { admin: true, auth: true })).status).toBe(400);
  expect((await request({ ...body, note: '' }, { admin: true, auth: true })).status).toBe(400);
  const saved = await request(body, { admin: true, auth: true });
  expect(saved.status).toBe(303); expect(saved.headers.Location).toContain('#automatic-map-review');
  expect((await request(body, { admin: true, auth: true })).status).toBe(409);
  const loaded = await request(undefined, { query: `city=zurich&map=${id}` });
  expect(loaded.data.map.automatic).toMatchObject({ status: 'blocked', revision: 2, note: body.note });
  const statuses = await request(undefined, { query: `city=zurich&mapStatuses=${id},${otherId}` });
  expect(statuses.data.maps).toEqual([{ id, name: suggestion.name, automaticStatus: 'blocked' }]);
  expect((await request(undefined, { query: 'mapStatuses=invalid' })).status).toBe(400);
});
it('shows escaped requests in the admin queue without publication buttons', async () => {
  const result = await request({ ...suggestion, name: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' });
  const html = automaticMapReviewCards([{ city: 'zurich', map: result.data.map }]);
  expect(html).toContain('id="automatic-map-review"'); expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<img src=x'); expect(html).not.toContain('Freigeben und veröffentlichen');
  const admin = await request(undefined, { admin: true, auth: true });
  expect(admin.status).toBe(200); expect(admin.output).toContain('&lt;script&gt;');
});
