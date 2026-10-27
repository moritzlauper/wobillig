import { beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { Dataset } from '../src/data';
import { emptyPizzaRatingState, PizzaRatingWriteConflict, pizzaRatingVisitor, readPizzaRating, votePizzaRating, type PizzaRatingState, type PizzaRatingStore } from '../server/pizza-rating';
const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/pizza-rating.js', async importOriginal => ({ ...await importOriginal<typeof import('../server/pizza-rating')>(), pizzaRatingStore: mocks.store }));
import handler from '../api/pizza-rating';

const bar = (JSON.parse(readFileSync('public/data/pizza.json', 'utf8')) as Dataset).bars[0];
let state: PizzaRatingState;
let store: PizzaRatingStore;

function memoryStore(fail = 0): PizzaRatingStore {
  let revision = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(revision) }; },
    async write(next, etag) {
      if (fail > 0) { fail--; throw new PizzaRatingWriteConflict(); }
      if (etag !== String(revision)) throw new PizzaRatingWriteConflict();
      state = structuredClone(next);
      revision++;
    },
  };
}

beforeEach(() => {
  state = emptyPizzaRatingState();
  store = memoryStore();
  mocks.store.mockImplementation(() => store);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
});

it('averages votes and lets a visitor change the vote on the same day', async () => {
  await votePizzaRating(store, 'zurich:1', 'a', 4, '2026-10-27');
  await votePizzaRating(store, 'zurich:1', 'b', 2, '2026-10-27');
  expect(await votePizzaRating(store, 'zurich:1', 'a', 5, '2026-10-27')).toEqual({ average: 3.5, count: 2, mine: 5 });
  expect(await votePizzaRating(store, 'zurich:1', 'a', 5, '2026-10-27')).toEqual({ average: 3.5, count: 2, mine: 5 });
});

it('keeps totals on a new day but drops the visitor vote until they vote again', async () => {
  await votePizzaRating(store, 'zurich:1', 'a', 4, '2026-10-27');
  expect(await readPizzaRating(store, 'zurich:1', 'a', '2026-10-28')).toEqual({ average: 4, count: 1, mine: null });
  expect(await votePizzaRating(store, 'zurich:1', 'a', 2, '2026-10-28')).toEqual({ average: 3, count: 2, mine: 2 });
});

it('reports no average for a venue without votes', async () => {
  expect(await readPizzaRating(store, 'zurich:9', 'a', '2026-10-27')).toEqual({ average: null, count: 0, mine: null });
});

it('retries after a write conflict without counting the vote twice', async () => {
  store = memoryStore(2);
  const result = await votePizzaRating(store, 'zurich:1', 'a', 3, '2026-10-27');
  expect(result).toEqual({ average: 3, count: 1, mine: 3 });
  expect(state.totals['zurich:1']).toEqual({ sum: 3, count: 1 });
});

it('hashes visitors per day and per address without storing the address', () => {
  const today = pizzaRatingVisitor('203.0.113.7', '2026-10-27', 'test-secret');
  expect(today).toMatch(/^[a-f0-9]{64}$/);
  expect(today).not.toContain('203.0.113.7');
  expect(pizzaRatingVisitor('203.0.113.7', '2026-10-28', 'test-secret')).not.toBe(today);
  expect(pizzaRatingVisitor('203.0.113.8', '2026-10-27', 'test-secret')).not.toBe(today);
});

let visitor = 0;
async function request(search: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? [] : [JSON.stringify(body)];
  const req = Object.assign(Readable.from(payload), { method, url: `/api/pizza-rating${search}`,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: `10.0.0.${++visitor}` } }) as unknown as IncomingMessage & { body?: unknown };
  let data: unknown;
  const res = { statusCode: 0, setHeader: vi.fn(), end: (text: string) => { data = JSON.parse(text); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data };
}

it('rates only pizzerias from the dataset', async () => {
  const query = `?city=zurich&bar=${encodeURIComponent(bar.id)}`;
  expect((await request(query)).status).toBe(200);
  expect((await request('?city=zurich&bar=node%2Funknown')).status).toBe(404);
  expect((await request('?city=atlantis&bar=x')).status).toBe(400);
});

it('accepts only whole stars from 1 to 5 from the same origin', async () => {
  for (const stars of [0, 6, 2.5, '3']) expect((await request('', 'POST', { city: 'zurich', bar: bar.id, stars })).status).toBe(400);
  expect((await request('', 'POST', { city: 'zurich', bar: bar.id, stars: 4 }, { origin: 'https://evil.example' })).status).toBe(403);
  const saved = await request('', 'POST', { city: 'zurich', bar: bar.id, stars: 4 });
  expect(saved).toEqual({ status: 200, data: { average: 4, count: 1, mine: 4 } });
});
