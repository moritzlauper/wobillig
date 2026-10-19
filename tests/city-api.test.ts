import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), blobStore: vi.fn(), savePrice: vi.fn(), saveVenue: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../server/prices.js', () => ({ blobStore: mocks.blobStore, savePrice: mocks.savePrice, saveVenue: mocks.saveVenue }));
import handler from '../api/prices';

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
  mocks.readFile.mockImplementation(async (path: string) => JSON.stringify({ bars: [{ id: path.includes('/bern/') ? 'node/bern' : path.includes('/basel/') ? 'node/basel' : 'node/zurich', name: 'Test', offers: [] }] }));
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
    expect((await request('/api/prices?city=bern')).data).toEqual({ entries: [], venues: [{ id: 'community/new' }] });
  });

  it('accepts prices for a community venue only from that city’s stored catalogue', async () => {
    mocks.blobStore.mockImplementation((path: string) => ({ read: async () => ({ state: { entries: [],
      venues: path.includes('/bern/') ? [{ id: 'community/new', name: 'New café', offers: [] }] : [] } }) }));
    const input = { barId: 'community/new', drink: 'coffee', coffeeType: 'espresso', name: 'Espresso', priceChf: 4.5,
      revision: 0, volumeMl: null, alcoholFree: true, observedAt: '2026-10-19', sourceUrl: '' };
    expect((await request('/api/prices?city=bern', input)).status).toBe(200);
    expect((await request('/api/prices?city=basel', input)).status).toBe(400);
    expect(mocks.savePrice).toHaveBeenCalledTimes(1);
  });

});
