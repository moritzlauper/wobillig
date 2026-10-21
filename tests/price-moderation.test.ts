import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, savePrice, WriteConflict, type State, type Store } from '../server/prices';
import { priceConcern, visiblePrices } from '../server/price-moderation';
import { offerKey, type PriceEntry, type PriceInput } from '../src/community';
import type { Dataset } from '../src/data';
import { reviewRows } from '../server/price-review.mjs';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
import handler from '../api/prices';

const coffee = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
const bar = coffee.bars.find(b => b.offers.some(o => o.coffeeType === 'cappuccino' && o.priceChf < 10))!;
const offer = bar.offers.find(o => o.coffeeType === 'cappuccino')!;
const input: PriceInput = { barId: bar.id, drink: 'coffee', revision: 0, targetKey: offerKey(offer),
  name: offer.name, coffeeType: offer.coffeeType, priceChf: 20, volumeMl: null, alcoholFree: true,
  observedAt: '2026-10-20', sourceUrl: offer.sourceUrl };
const data = { beer: { ...coffee, bars: [] }, coffee };
let store: Store;

async function request(body?: unknown, cookie?: string, ip = 'same-ip', city = 'zurich') {
  const req = { url: `/api/prices?city=${city}`, method: body ? 'POST' : 'GET', body,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', cookie },
    socket: { remoteAddress: ip } } as IncomingMessage & { body?: unknown };
  let result: any;
  const headers: Record<string, string> = {};
  const res = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; },
    end: (text: string) => { result = JSON.parse(text); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data: result, headers };
}

beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
  vi.stubEnv('VERCEL_ENV', 'production');
  let state = emptyState(), version = 0;
  store = {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next: State, etag?: string) {
      if (etag !== String(version)) throw new WriteConflict();
      state = structuredClone(next); version++;
    },
  };
  mocks.store.mockReturnValue(store);
});
afterEach(() => vi.unstubAllEnvs());

it('holds all three vandalism patterns, including submitted source URLs', () => {
  for (const [drink, before, after] of [['coffee', 3, 20], ['pizza', 14, 40], ['pizza', 19, 50]] as const) {
    const entry = { drink, offer: { ...offer, priceChf: after } } as PriceEntry;
    expect(priceConcern(entry, { ...offer, priceChf: before })).toBeTruthy();
  }
  expect(priceConcern({ drink: 'coffee', offer: { ...offer, priceChf: 10 } } as PriceEntry, { ...offer, priceChf: 3 })).toBe('large-increase');
  expect(priceConcern({ drink: 'coffee', offer: { ...offer, priceChf: 1 } } as PriceEntry, { ...offer, priceChf: 5 })).toBe('large-decrease');
  expect(priceConcern({ drink: 'coffee', offer: { ...offer, priceChf: 1.5 } } as PriceEntry, null)).toBeUndefined();
  expect(priceConcern({ drink: 'beer', offer: { ...offer, priceChf: 29, volumeMl: 750 } } as PriceEntry, null)).toBeUndefined();
});

it('returns normal success and persists only the submitting browser’s view across reloads and IP changes', async () => {
  const newOffer = { ...input, targetKey: undefined, name: 'New cappuccino' };
  const saved = await request(newOffer);
  expect(saved.status).toBe(200);
  expect(Object.keys(saved.data)).toEqual(['entry', 'pending']);
  expect(saved.data.pending).toBe(true);
  expect(saved.data.entry.offer.priceChf).toBe(20);
  expect(saved.headers['Set-Cookie']).toContain('HttpOnly; SameSite=Lax');
  expect(saved.headers['Set-Cookie']).toContain('; Secure');
  const cookie = saved.headers['Set-Cookie'].split(';')[0];
  expect((await request()).data.entries).toEqual([]);
  expect((await request(undefined, 'wobillig-price-view=' + 'a'.repeat(64))).data.entries).toEqual([]);
  const own = await request(undefined, cookie, 'changed-ip');
  expect(own.data.entries).toEqual([saved.data.entry]);
  expect(own.headers['Cache-Control']).toBe('private, no-store');
  expect(own.headers.Vary).toBe('Cookie');
  expect(Object.keys(own.data).filter(key => key !== 'venueCorrections').sort()).toEqual(['coffeeRatings', 'entries', 'publicMaps', 'venues']);
  const state = (await store.read()).state;
  expect(state.entries).toEqual([]);
  expect(state.history).toEqual([]);
  expect(state.priceChanges).toBeUndefined();
  expect(state.heldPrices).toHaveLength(1);
  expect(JSON.stringify(state)).not.toContain(cookie.split('=')[1]);
  expect(reviewRows(state, 'zurich', [bar])).toEqual([]);
  const edited = await request({ ...newOffer, id: saved.data.entry.id, revision: 1, priceChf: 21 }, cookie);
  expect(edited.status).toBe(200);
  expect(edited.data.entry.revision).toBe(2);
  expect((await request(undefined, cookie)).data.entries[0].offer.priceChf).toBe(21);
  expect((await request()).data.entries).toEqual([]);
  expect((await request({ ...input, id: saved.data.entry.id, revision: 2 } )).status).toBe(409);
});

it('requires a menu photo for large changes and leaves public prices untouched', async () => {
  await expect(savePrice(store, input, data, 'troll')).rejects.toMatchObject({ status: 422 });
  expect((await store.read()).state.entries).toEqual([]);
  const normal = await savePrice(store, { ...input, priceChf: offer.priceChf + .5 }, data, 'normal');
  await expect(savePrice(store, { ...input, id: normal.id, revision: 1 }, data, 'troll')).rejects.toMatchObject({ status: 422 });
  expect(visiblePrices((await store.read()).state, 'normal')[0]).toEqual(normal);
});

it('rate limits held prices and retries storage conflicts without leaking them to public state', async () => {
  const write = store.write.bind(store);
  let conflict = true;
  store.write = async (state, etag) => {
    if (conflict) { conflict = false; throw new WriteConflict(); }
    await write(state, etag);
  };
  let entry = await savePrice(store, { ...input, targetKey: undefined, name: 'New cappuccino' }, data, 'troll');
  for (let n = 1; n < 20; n++) entry = await savePrice(store, { ...input, id: entry.id, revision: entry.revision }, data, 'troll');
  await expect(savePrice(store, { ...input, id: entry.id, revision: entry.revision }, data, 'troll')).rejects.toMatchObject({ status: 429 });
  const state = (await store.read()).state;
  expect(state.entries).toEqual([]);
  expect(state.heldPrices).toHaveLength(1);
  expect(state.heldPrices![0].entry.revision).toBe(20);
});

it('enforces the shared IP cooldown across cities even when cookies are discarded', async () => {
  for (let i = 0; i < 5; i++) expect((await request({ ...input, targetKey: undefined, name: 'New cappuccino' })).status).toBe(200);
  const bern = JSON.parse(readFileSync('public/data/bern/coffee.json', 'utf8')) as Dataset;
  const venue = bern.bars.find(b => b.offers.some(o => o.coffeeType === 'espresso'))!;
  const espresso = venue.offers.find(o => o.coffeeType === 'espresso')!;
  const result = await request({ ...input, barId: venue.id, name: espresso.name, coffeeType: 'espresso', targetKey: offerKey(espresso) },
    undefined, 'same-ip', 'bern');
  expect(result.status).toBe(429);
  expect(result.data.retryAfter).toBeGreaterThan(590);
  expect(result.headers['Retry-After']).toBe(String(result.data.retryAfter));
  expect((await store.read()).state.heldPrices).toHaveLength(5);
  expect(mocks.store).toHaveBeenCalledWith('prices/cooldowns/production.json');
  expect((await request()).data).not.toHaveProperty('priceCooldowns');
});

it('enforces the browser cooldown even when IP addresses change', async () => {
  const first = await request({ ...input, targetKey: undefined, name: 'New cappuccino' }, undefined, 'ip-0');
  const cookie = first.headers['Set-Cookie'].split(';')[0];
  let entry = first.data.entry;
  for (let i = 1; i < 5; i++) {
    const next = await request({ ...input, id: entry.id, revision: entry.revision }, cookie, `ip-${i}`);
    expect(next.status).toBe(200);
    entry = next.data.entry;
  }
  expect((await request({ ...input, id: entry.id, revision: entry.revision }, cookie, 'ip-new')).status).toBe(429);
  expect((await request()).data.entries).toEqual([]);
});
