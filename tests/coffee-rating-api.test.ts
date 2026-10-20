import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Dataset } from '../src/data';
import { emptyState, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import handler from '../api/prices';
const bar = (JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset).bars[0];
const vote = { action: 'rateCoffee', barId: bar.id, score: 5, voterToken: randomUUID() };

async function request(method = 'GET', body?: unknown, headers: Record<string, string> = {}, city = 'zurich') {
  const req = Object.assign(Readable.from([]), { method, body, url: `/api/prices?city=${city}`,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: 'test-visitor' } }) as IncomingMessage & { body?: unknown };
  let data: any;
  const res = { statusCode: 0, setHeader: vi.fn(), end: (text: string) => { data = JSON.parse(text); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data };
}
beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
  const states = new Map<string, ReturnType<typeof emptyState>>();
  mocks.store.mockImplementation((path: string): Store => ({
    async read() { return { state: structuredClone(states.get(path) || emptyState()) }; },
    async write(state) { states.set(path, structuredClone(state)); },
  }));
});
afterEach(() => vi.unstubAllEnvs());

it('persists a coffee rating and exposes only public aggregates, separated by city', async () => {
  expect((await request()).data.coffeeRatings).toEqual({});
  expect(await request('POST', vote)).toEqual({ status: 200, data: { rating: { average: 5, count: 1 } } });
  expect((await request('POST', { ...vote, score: 3 })).data.rating).toEqual({ average: 3, count: 1 });
  const result = await request();
  expect(result.data.coffeeRatings[bar.id]).toEqual({ average: 3, count: 1 });
  expect(Object.keys(result.data).sort()).toEqual(['coffeeRatings', 'entries', 'venues']);
  expect(JSON.stringify(result.data)).not.toContain(vote.voterToken);
  expect((await request('GET', undefined, {}, 'bern')).data.coffeeRatings).toEqual({});
});
it('rejects foreign submissions, invalid scores, missing venues and unsupported methods', async () => {
  expect((await request('POST', vote, { origin: 'https://other.org' })).status).toBe(403);
  expect((await request('POST', vote, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await request('POST', vote, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await request('POST', { ...vote, score: 6 })).status).toBe(400);
  expect((await request('POST', { ...vote, barId: 'unknown' })).status).toBe(400);
  expect((await request('DELETE', vote)).status).toBe(405);
  expect((await request()).data.coffeeRatings).toEqual({});
});
