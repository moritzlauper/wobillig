import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, WriteConflict, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import handler from '../api/prices';

const id = '52251319-7e51-44e3-b6c0-5f3105d2f22e';
const venue = { id: 'node/legacy-falafel', name: 'Falafel', lat: 47.38, lon: 8.53, address: '', postcode: '' };
const legacy = { id, name: 'falafel', createdAt: '2026-10-20T19:58:10.600Z', entries: [
  { venue, product: 'Falafel', priceChf: 4.59, revision: 1, updatedAt: '2026-10-20T19:58:10.600Z' },
] };
let store: Store;
const token = (city = 'zurich', expires = Date.now() + 3600000, mapId = id) =>
  `${expires}.${createHmac('sha256', 'test-secret').update(`map-recovery:${city}:${mapId}:${expires}`).digest('hex')}`;

beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('CONTRIBUTION_PROTECTION', 'false');
  vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', 'false');
  let state = { ...emptyState(), customMaps: [structuredClone(legacy)] }, version = 0;
  store = {
    read: async () => ({ state: structuredClone(state), etag: String(version) }),
    write: async (next, etag) => {
      if (etag !== String(version)) throw new WriteConflict();
      state = structuredClone(next) as typeof state; version++;
    },
  };
  mocks.store.mockReturnValue(store);
});
afterEach(() => vi.unstubAllEnvs());

async function request(body?: object, cookie?: string) {
  const req = { url: `/api/prices?city=zurich${body ? '' : `&map=${id}`}`, method: body ? 'POST' : 'GET', body,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', cookie },
    socket: { remoteAddress: 'test-ip' } } as IncomingMessage & { body?: unknown };
  const headers: Record<string, any> = {}; let data: any;
  const res = { statusCode: 0, getHeader: (key: string) => headers[key],
    setHeader: (key: string, value: unknown) => { headers[key] = value; },
    end: (value: string) => { data = JSON.parse(value); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data, cookie: [headers['Set-Cookie'] || []].flat().map((value: string) => value.split(';')[0]).join('; ') };
}

it('restores a legacy map, preserves its entry, and permits owner edits after reload', async () => {
  const before = await request();
  expect(before.data.map.canEdit).toBe(false);
  const recoveryToken = token();
  const restored = await request({ action: 'recoverMap', mapId: id, recoveryToken }, before.cookie);
  expect(restored.status).toBe(200);
  expect(restored.data.map).toEqual({ ...legacy, canEdit: true });
  expect((await request(undefined, before.cookie)).data.map.canEdit).toBe(true);
  expect((await request({ action: 'recoverMap', mapId: id, recoveryToken }, before.cookie)).status).toBe(200);
  const edit = await request({ action: 'saveMapEntry', mapId: id, barId: venue.id, product: 'Falafel', priceChf: 5, revision: 1 }, before.cookie);
  expect(edit.status).toBe(200);
  expect(edit.data.map.entries[0]).toMatchObject({ priceChf: 5, revision: 2 });
  const other = await request();
  expect(other.data.map.canEdit).toBe(false);
  expect((await request({ action: 'recoverMap', mapId: id, recoveryToken }, other.cookie)).status).toBe(403);
});

it('rejects public IDs, expired, modified, wrong-city and wrong-map recovery links without assigning an owner', async () => {
  for (const recoveryToken of [undefined, id, token('zurich', Date.now() - 1), token() + 'x', token('bern'), token('zurich', Date.now() + 3600000, 'd268dbea-93cf-45de-9d17-2b5c74090236')]) {
    expect((await request({ action: 'recoverMap', mapId: id, recoveryToken })).status).toBe(403);
  }
  expect((await store.read()).state.mapOwners).toBeUndefined();
  expect((await store.read()).state.customMaps).toEqual([legacy]);
});

it('cannot overwrite an existing owner and grants only one browser access during competing claims', async () => {
  const recoveryToken = token();
  const results = await Promise.all([
    request({ action: 'recoverMap', mapId: id, recoveryToken }),
    request({ action: 'recoverMap', mapId: id, recoveryToken }),
  ]);
  expect(results.map(result => result.status).sort()).toEqual([200, 403]);
  const winner = results.find(result => result.status === 200)!;
  expect((await request(undefined, winner.cookie)).data.map.canEdit).toBe(true);
});
