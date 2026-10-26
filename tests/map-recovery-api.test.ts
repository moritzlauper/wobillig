import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, WriteConflict, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import handler from '../api/prices';
import { signMapPlace } from '../server/map-places';
import { sessionCookie } from '../server/email-auth';
import type { City } from '../src/cities';

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

async function request(body?: object, cookie?: string, city: City = 'zurich') {
  const req = { url: `/api/prices?city=${city}${body ? '' : `&map=${id}`}`, method: body ? 'POST' : 'GET', body,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', cookie },
    socket: { remoteAddress: 'test-ip' } } as IncomingMessage & { body?: unknown };
  const headers: Record<string, any> = {}; let data: any;
  const res = { statusCode: 0, getHeader: (key: string) => headers[key],
    setHeader: (key: string, value: unknown) => { headers[key] = value; },
    end: (value: string) => { data = JSON.parse(value); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data, cookie: [headers['Set-Cookie'] || []].flat().map((value: string) => value.split(';')[0]).join('; ') };
}

it('restores a legacy map, preserves its entry, and retains collaborative edits after reload', async () => {
  const before = await request();
  expect(before.data.map.canEdit).toBe(true);
  const recoveryToken = token();
  const restored = await request({ action: 'recoverMap', mapId: id, recoveryToken });
  expect(restored.status).toBe(200);
  expect(restored.data.map).toEqual({ ...legacy, canEdit: true });
  expect((await request(undefined, restored.cookie)).data.map.canEdit).toBe(true);
  expect((await request({ action: 'recoverMap', mapId: id, recoveryToken }, restored.cookie)).status).toBe(200);
  const edit = await request({ action: 'saveMapEntry', mapId: id, barId: venue.id, product: 'Falafel', priceChf: 5, revision: 1 }, restored.cookie);
  expect(edit.status).toBe(200);
  expect(edit.data.map.entries[0]).toMatchObject({ priceChf: 5, revision: 2 });
  const other = await request();
  expect(other.data.map.canEdit).toBe(true);
  expect((await request({ action: 'recoverMap', mapId: id, recoveryToken }, other.cookie)).status).toBe(403);
});

it('rejects public IDs, expired, modified, wrong-city and wrong-map recovery links without assigning an owner', async () => {
  for (const recoveryToken of [undefined, id, token('zurich', Date.now() - 1), token() + 'x', token('bern'), token('zurich', Date.now() + 3600000, 'd268dbea-93cf-45de-9d17-2b5c74090236')]) {
    expect((await request({ action: 'recoverMap', mapId: id, recoveryToken })).status).toBe(403);
  }
  expect((await store.read()).state.mapOwners).toBeUndefined();
  expect((await store.read()).state.customMaps).toEqual([legacy]);
});

it('cannot overwrite an existing owner and retains the first creator attribution during competing claims', async () => {
  const recoveryToken = token();
  const results = await Promise.all([
    request({ action: 'recoverMap', mapId: id, recoveryToken }),
    request({ action: 'recoverMap', mapId: id, recoveryToken }),
  ]);
  expect(results.map(result => result.status).sort()).toEqual([200, 403]);
  const winner = results.find(result => result.status === 200)!;
  expect((await request(undefined, winner.cookie)).data.map.canEdit).toBe(true);
});

for (const city of ['zurich', 'bern', 'basel', 'lausanne', 'geneva', 'winterthur'] as const) {
  for (const owner of [undefined, { browser: 'original' }, { browser: 'original', account: 'original-account' }]) {
    it(`allows anonymous and signed-in contributors to edit ${city} maps with ${owner ? owner.account ? 'account' : 'browser' : 'no'} creator`, async () => {
      const { state, etag } = await store.read();
      if (owner) state.mapOwners = { [id]: owner };
      await store.write(state, etag);
      const before = await request(undefined, undefined, city);
      expect(before.data.map.canEdit).toBe(true);
      const edited = await request({ action: 'saveMapEntry', mapId: id, barId: venue.id, product: 'Falafel', priceChf: 5, revision: 1 }, undefined, city);
      expect(edited.status).toBe(200);
      expect(edited.data.map.entries[0]).toMatchObject({ priceChf: 5, revision: 2 });
      let accountCookie = '';
      sessionCookie({ getHeader: () => undefined, setHeader: (_key: string, value: string) => { accountCookie = value.split(';')[0]; } } as unknown as ServerResponse, 'a'.repeat(64));
      const addedVenue = { ...venue, id: 'node/new-place', name: 'New place' };
      const place = signMapPlace({ ...addedVenue, type: 'cafe', offers: [], website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'osm' }, city);
      const added = await request({ action: 'saveMapEntry', mapId: id, barId: addedVenue.id, placeToken: place.token, product: 'Falafel', priceChf: 6, revision: 0 }, accountCookie, city);
      expect(added.status).toBe(200);
      expect(added.data.map.entries).toHaveLength(2);
      expect((await store.read()).state.mapOwners?.[id]).toEqual(owner);
      expect((await request(undefined, undefined, city)).data.map.canEdit).toBe(true);
      const stale = await request({ action: 'saveMapEntry', mapId: id, barId: venue.id, product: 'Falafel', priceChf: 7, revision: 1 }, undefined, city);
      expect(stale.status).toBe(409);
      const publication = await request({ action: 'requestMapPublication', mapId: id }, accountCookie, city);
      expect(publication.status).toBe(200);
      expect(publication.data.map.publication.status).toBe('pending');
    });
  }
}
