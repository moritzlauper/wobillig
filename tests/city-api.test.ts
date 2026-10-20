import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bar, Dataset } from '../src/data';

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), blobStore: vi.fn(), savePrice: vi.fn(), saveVenue: vi.fn(), saveVenueCorrection: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../server/prices.js', () => ({ blobStore: mocks.blobStore, savePrice: mocks.savePrice, saveVenue: mocks.saveVenue }));
vi.mock('../server/price-cooldown.js', async original => ({
  ...await original<typeof import('../server/price-cooldown')>(),
  withPriceCooldown: (_store: unknown, _ip: string, _owner: string, save: () => Promise<unknown>) => save(),
}));
vi.mock('../server/venue-corrections.js', () => ({ saveVenueCorrection: mocks.saveVenueCorrection }));
import handler from '../api/prices';

function venue(id: string, name = 'Test'): Bar {
  return { id, name, lat: 46.948, lon: 7.447, type: 'cafe', address: '', postcode: '', website: null,
    openingHours: null, outdoor: false, offers: [], scrapeStatus: 'unavailable', checkedAt: null };
}

async function request(url: string, body?: unknown) {
  const req = { url, method: body ? 'POST' : 'GET', body, headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage & { body?: unknown };
  let data: any;
  const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { data = JSON.parse(value); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
  mocks.blobStore.mockImplementation((path: string) => ({ read: async () => ({ state: { entries: [{ id: path }] } }) }));
  mocks.readFile.mockImplementation(async (path: string) => JSON.stringify({
    generatedAt: '', discoveredAt: '', attribution: '',
    bars: [venue(path.includes('/bern/') ? 'node/bern' : path.includes('/basel/') ? 'node/basel' : 'node/zurich')],
  } satisfies Dataset));
  mocks.savePrice.mockResolvedValue({ id: 'saved' });
  mocks.saveVenue.mockResolvedValue({ venue: { id: 'community/new' }, created: true });
});
describe('city-scoped price API', () => {
  it('keeps old clients on the Zürich store and reads only the requested city', async () => {
    for (const [query, path] of [['', 'prices/production.json'], ['?city=bern', 'prices/bern/production.json'], ['?city=basel', 'prices/basel/production.json']]) {
      expect((await request('/api/prices' + query)).data.entries).toEqual([{ id: path }]);
    }
  });
  it('rejects unknown city names before accessing storage', async () => {
    expect((await request('/api/prices?city=../../private')).status).toBe(400);
    expect(mocks.blobStore).not.toHaveBeenCalled();
  });
  it('loads only the requested custom map and does not list other maps or private storage', async () => {
    const map = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Döner', entries: [] };
    mocks.blobStore.mockReturnValue({ read: async () => ({ state: {
      entries: [], customMaps: [map, { id: 'another-map', name: 'Other', entries: [] }], limits: { secret: {} },
    } }) });
    expect((await request(`/api/prices?city=bern&map=${map.id}`)).data).toEqual({ map });
    expect((await request('/api/prices?city=bern')).data).toEqual({ entries: [], venues: [], venueCorrections: [], coffeeRatings: {}, publicMaps: [] });
    expect((await request('/api/prices?map=invalid')).status).toBe(400);
    expect((await request('/api/prices?map=d268dbea-93cf-45de-9d17-2b5c74090237')).status).toBe(404);
  });
  it('does not expose the private audit log, history or visitor limits', async () => {
    mocks.blobStore.mockReturnValue({ read: async () => ({ state: {
      entries: [], history: [{ id: 'old' }], priceChanges: [{ id: 'private-change' }], limits: { visitor: { count: 1 } },
      coffeeVotes: { 'node/zurich': { 'private-voter': 4 } },
    } }) });
    expect((await request('/api/prices')).data).toEqual({ entries: [], venues: [], venueCorrections: [], coffeeRatings: { 'node/zurich': { average: null, count: 1 } }, publicMaps: [] });
  });
  it('publicly lists only maps with at least five distinct venues in the selected city', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ venue: { id: `node/${i}` }, priceChf: 12 }));
    const maps = [
      { id: 'four', name: 'Four', entries: entries.slice(0, 4) },
      { id: 'five', name: 'Five', entries: entries.slice(0, 5) },
      { id: 'six', name: 'Six', entries },
      { id: 'duplicates', name: 'Duplicates', entries: Array(5).fill(entries[0]) },
    ];
    mocks.blobStore.mockImplementation((path: string) => ({ read: async () => ({ state: {
      entries: [], customMaps: path.includes('/bern/') ? maps : [],
    } }) }));
    expect((await request('/api/prices?city=bern')).data.publicMaps).toEqual([
      { id: 'five', name: 'Five', venueCount: 5 }, { id: 'six', name: 'Six', venueCount: 6 },
    ]);
    expect((await request('/api/prices?city=basel')).data.publicMaps).toEqual([]);
  });
  it('saves a Bern venue only in Bern and rejects that ID in Basel', async () => {
    const input = { barId: 'node/bern', drink: 'beer', revision: 0, name: 'Lager', priceChf: 5, volumeMl: 300, alcoholFree: false, observedAt: '2026-10-14', sourceUrl: '' };
    expect((await request('/api/prices?city=bern', input)).status).toBe(200);
    expect(mocks.savePrice).toHaveBeenCalledTimes(1);
    expect((await request('/api/prices?city=basel', input)).status).toBe(400);
    expect(mocks.savePrice).toHaveBeenCalledTimes(1);
    expect(mocks.readFile.mock.calls.some(([path]) => path.includes('/data/bern/bars.json'))).toBe(true);
    expect(mocks.readFile.mock.calls.some(([path]) => path.includes('/data/basel/bars.json'))).toBe(true);
  });
  it('routes new venues to the selected city and exposes them independently of prices', async () => {
    const result = await request('/api/prices?city=bern', { action: 'addVenue', venue: { name: 'Testcafé' } });
    expect(result.status).toBe(200); expect(result.data.created).toBe(true);
    expect(mocks.saveVenue.mock.calls[0][3]).toBe('bern');
    expect(mocks.blobStore).toHaveBeenCalledWith('prices/bern/production.json');
    mocks.blobStore.mockReturnValue({ read: async () => ({ state: { entries: [], venues: [{ id: 'community/new' }] } }) });
    expect((await request('/api/prices?city=bern')).data).toEqual({ entries: [], venues: [{ id: 'community/new' }], venueCorrections: [], coffeeRatings: {}, publicMaps: [] });
  });

  it('routes corrections to the selected city and publishes corrections without their audit history', async () => {
    const correction = { barId: 'node/bern', revision: 1, changes: { website: 'https://correct.example/' }, updatedAt: '2026-10-20' };
    mocks.saveVenueCorrection.mockResolvedValue({ correction });
    const body = { action: 'correctVenue', barId: 'node/bern', revision: 0, changes: correction.changes };
    expect(await request('/api/prices?city=bern', body)).toMatchObject({ status: 200, data: { correction } });
    expect(mocks.blobStore).toHaveBeenCalledWith('prices/bern/production.json');
    expect(mocks.saveVenueCorrection.mock.calls[0][1]).toEqual(body);
    expect(mocks.saveVenueCorrection.mock.calls[0][2].coffee.bars[0].id).toBe('node/bern');
    mocks.blobStore.mockReturnValue({ read: async () => ({ state: {
      entries: [], venueCorrections: [correction], venueCorrectionHistory: [{ before: { website: 'private' } }],
    } }) });
    const read = await request('/api/prices?city=bern');
    expect(read.data.venueCorrections).toEqual([correction]);
    expect(read.data).not.toHaveProperty('venueCorrectionHistory');
  });

  it('accepts prices for a community venue only from that city’s stored catalogue', async () => {
    mocks.blobStore.mockImplementation((path: string) => ({ read: async () => ({ state: { entries: [],
      venues: path.includes('/bern/') ? [venue('community/new', 'New café')] : [] } }) }));
    const input = { barId: 'community/new', drink: 'coffee', coffeeType: 'espresso', name: 'Espresso', priceChf: 4.5,
      revision: 0, volumeMl: null, alcoholFree: true, observedAt: '2026-10-19', sourceUrl: '' };
    expect((await request('/api/prices?city=bern', input)).status).toBe(200);
    expect((await request('/api/prices?city=basel', input)).status).toBe(400);
    expect(mocks.savePrice).toHaveBeenCalledTimes(1);
  });

});
