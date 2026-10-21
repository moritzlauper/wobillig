import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { Dataset } from '../src/data';
import { emptyRatingState, RatingWriteConflict, type RatingStore } from '../server/google-rating-cache';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), store: vi.fn() }));
vi.mock('../server/google-rating.js', () => ({ fetchGoogleRating: mocks.fetch }));
vi.mock('../server/google-rating-cache.js', async importOriginal => ({ ...await importOriginal<typeof import('../server/google-rating-cache')>(), googleRatingStore: mocks.store }));
import handler from '../api/google-rating';
const bar = (JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset).bars[0];
let visitor = 0;
const query = `?city=zurich&bar=${encodeURIComponent(bar.id)}`;
async function request(search = query, method = 'GET', headers: Record<string, string> = {}, ip = String(++visitor)) {
  const req = Object.assign(Readable.from([]), { method, url: `/api/google-rating${search}`,
    headers: { host: 'example.org', ...headers }, socket: { remoteAddress: ip } }) as unknown as IncomingMessage;
  let data: unknown;
  const setHeader = vi.fn();
  const res = { statusCode: 0, setHeader, end: (text: string) => { data = JSON.parse(text); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data, setHeader };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('GOOGLE_PLACES_API_KEY', 'private-test-key'); mocks.fetch.mockResolvedValue(null);
  let state = emptyRatingState(), revision = 0;
  const store: RatingStore = {
    async read() { return { state: structuredClone(state), etag: String(revision) }; },
    async write(next, etag) { if (etag !== String(revision)) throw new RatingWriteConflict(); state = structuredClone(next); revision++; },
  };
  mocks.store.mockReturnValue(store);
});
afterEach(() => vi.unstubAllEnvs());
it('only queries known pizzerias with a server-side key', async () => {
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.data).toEqual({ rating: null });
  expect(mocks.fetch).toHaveBeenCalledWith(bar, 'Zürich', 'private-test-key');
  expect(result.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});
it('rejects arbitrary places, cities, foreign requests and write methods before querying Google', async () => {
  expect((await request('?city=zurich&bar=arbitrary-search')).status).toBe(404);
  expect((await request('?city=unknown&bar=x')).status).toBe(400);
  expect((await request(query, 'POST')).status).toBe(405);
  expect((await request(query, 'GET', { origin: 'https://other.org' })).status).toBe(403);
  expect((await request(query, 'GET', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('fails without leaking credentials when the key is missing or Google is unavailable', async () => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  expect((await request()).status).toBe(503);
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'private-test-key');
  mocks.fetch.mockRejectedValue(new Error('private-test-key'));
  const result = await request();
  expect(result.status).toBe(503);
  expect(JSON.stringify(result.data)).not.toContain('private-test-key');
});
it('coalesces concurrent requests and reuses the durable cache afterwards', async () => {
  let complete!: (result: null) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const first = request(), second = request();
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  complete(null);
  await Promise.all([first, second]);
  await request();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it('limits repeated endpoint requests from one visitor', async () => {
  for (let i = 0; i < 60; i++) expect((await request(query, 'GET', {}, 'limited-visitor')).status).toBe(200);
  expect((await request(query, 'GET', {}, 'limited-visitor')).status).toBe(429);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('makes no Google calls if the shared budget store is unavailable', async () => {
  mocks.store.mockReturnValue({ read: async () => { throw new Error('offline'); } });
  expect((await request()).status).toBe(503);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
