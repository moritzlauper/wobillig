import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Dataset } from '../src/data';
import { emptyState, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn(), verify: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
vi.mock('../server/coffee-photo.js', async original => ({ ...await original<typeof import('../server/coffee-photo')>(), verifyCoffeePhoto: mocks.verify }));
import handler from '../api/coffee-rating';
import pricesHandler from '../api/prices';
const bar = (JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset).bars[0];
const vote = { barId: bar.id, score: 5, image: { mediaType: 'image/jpeg', data: '/9j/2Q==' } };

async function request(method = 'POST', body: unknown = vote, headers: Record<string, string> = {}, target = handler, city = 'zurich', ip = 'test-visitor') {
  const req = Object.assign(Readable.from([]), { method, body, url: `/api/coffee-rating?city=${city}`,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: ip } }) as IncomingMessage & { body?: unknown };
  let data: any;
  const setHeader = vi.fn();
  const res = { statusCode: 0, setHeader, end: (text: string) => { data = JSON.parse(text); } } as unknown as ServerResponse;
  await target(req, res);
  const cookie = setHeader.mock.calls.find(([key]) => key === 'Set-Cookie')?.[1]?.split(';')[0];
  return { status: res.statusCode, data, cookie };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret'); vi.stubEnv('ANTHROPIC_API_KEY', 'test-api');
  mocks.verify.mockResolvedValue(undefined);
  const states = new Map<string, ReturnType<typeof emptyState>>();
  mocks.store.mockImplementation((path: string): Store => ({
    async read() { return { state: structuredClone(states.get(path) || emptyState()) }; },
    async write(state) { states.set(path, structuredClone(state)); },
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it('checks coffee photos, deduplicates retries and exposes only aggregates', async () => {
  const first = await request();
  expect(first.status).toBe(200); expect(first.data.rating).toEqual({ average: null, count: 1 });
  expect(first.cookie).toMatch(/^wobillig-browser=[a-f0-9]{64}\.[a-f0-9]{64}$/);
  const headers = { cookie: first.cookie };
  expect((await request('POST', { ...vote, voterToken: 'any-client-token' }, headers)).data).toEqual(first.data);
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  expect((await request('POST', { ...vote, score: 3 }, headers)).status).toBe(429);
  expect(mocks.verify).toHaveBeenCalledTimes(1);
  const result = await request('GET', undefined, {}, pricesHandler);
  expect(result.data.coffeeRatings[bar.id]).toEqual({ average: null, count: 1 });
  for (const key of ['coffeeVotes', 'coffeeVoteDetails', 'coffeePhotoUses', 'limits']) expect(result.data).not.toHaveProperty(key);
  expect((await request('GET', undefined, {}, pricesHandler, 'bern')).data.coffeeRatings).toEqual({});
});
it('rejects missing photos, legacy bypasses, foreign origins, invalid scores and missing venues before OCR', async () => {
  expect((await request('POST', { ...vote, image: undefined })).status).toBe(400);
  expect((await request('POST', { action: 'rateCoffee', barId: bar.id, score: 5, voterToken: 'fake' }, {}, pricesHandler)).status).toBe(422);
  expect((await request('POST', vote, { origin: 'https://other.org' })).status).toBe(403);
  expect((await request('POST', vote, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await request('POST', vote, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await request('POST', { ...vote, score: 6 })).status).toBe(400);
  expect((await request('POST', { ...vote, barId: 'unknown' })).status).toBe(400);
  expect((await request('DELETE')).status).toBe(405);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('does not accept reused images with a discarded or forged browser cookie', async () => {
  const first = await request();
  expect((await request()).status).toBe(422);
  expect((await request('POST', vote, { cookie: first.cookie.slice(0, -64) + '0'.repeat(64) })).status).toBe(422);
  expect(mocks.verify).toHaveBeenCalledTimes(1);
});
it('counts failed photo checks towards the shared IP quota, including discarded cookies', async () => {
  mocks.verify.mockRejectedValue(new Error('unavailable'));
  for (let n = 0; n < 5; n++) expect((await request()).status).toBe(503);
  expect((await request()).status).toBe(429);
  expect(mocks.verify).toHaveBeenCalledTimes(5);
  expect((await request('GET', undefined, {}, pricesHandler)).data.coffeeRatings).toEqual({});
});
it('does not send photos when the API configuration is missing', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  expect((await request()).status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
