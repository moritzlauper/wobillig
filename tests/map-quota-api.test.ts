import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, WriteConflict, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import handler from '../api/prices';
beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret'); vi.stubEnv('VERCEL_ENV', 'production');
  const stores = new Map<string, Store>();
  mocks.store.mockImplementation((path: string) => {
    if (!stores.has(path)) {
      let state = emptyState(), version = 0;
      stores.set(path, { read: async () => ({ state: structuredClone(state), etag: String(version) }), write: async (next, etag) => {
        if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++;
      } });
    }
    return stores.get(path);
  });
});
afterEach(() => vi.unstubAllEnvs());
async function request(id: string, ip = 'ip-1', cookie?: string, city = 'zurich') {
  const req = { url: `/api/prices?city=${city}`, method: 'POST', body: { action: 'createMap', mapId: id, name: 'Tampon-Map' },
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', cookie }, socket: { remoteAddress: ip } } as IncomingMessage & { body?: unknown };
  const headers: Record<string, string> = {}; let data: any;
  const res = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value: string) => { data = JSON.parse(value); } } as unknown as ServerResponse;
  await handler(req, res); return { status: res.statusCode, data, headers };
}
it('enforces the real creation API across cities, cookies and IPs while retaining idempotent retries', async () => {
  const firstId = 'd268dbea-93cf-45de-9d17-2b5c74090236', otherId = 'd268dbea-93cf-45de-9d17-2b5c74090237';
  const first = await request(firstId);
  expect(first.status).toBe(200);
  const cookie = first.headers['Set-Cookie'].split(';')[0];
  expect((await request(otherId, 'ip-1', undefined, 'bern')).status).toBe(429);
  expect((await request(otherId, 'ip-2', cookie, 'basel')).status).toBe(429);
  expect((await request(firstId, 'ip-1', cookie)).status).toBe(200);
  expect(mocks.store).toHaveBeenCalledWith('maps/quotas/production.json');
});
