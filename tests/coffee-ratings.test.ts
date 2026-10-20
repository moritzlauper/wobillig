import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { coffeeRatingSummaries, saveCoffeeRating } from '../server/coffee-ratings';
import { emptyState, WriteConflict, type Store } from '../server/prices';
import type { Dataset } from '../src/data';

const coffee = JSON.parse(readFileSync('public/data/coffee.json', 'utf8')) as Dataset;
const bar = coffee.bars[0];
const data = { coffee };
const input = { barId: bar.id, score: 4, voterToken: randomUUID() };
function memoryStore(): Store {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next, etag) {
      if (etag !== String(version)) throw new WriteConflict();
      state = structuredClone(next); version++;
    },
  };
}
const save = (store: Store, value: unknown = input, visitor = 'visitor', now = 1000) =>
  saveCoffeeRating(store, value, data, 'zurich', visitor, 'test-secret', now);

describe('shared coffee ratings', () => {
  it('shows a rating after the first vote, deduplicates retries and replaces the same browser vote', async () => {
    const store = memoryStore();
    expect(coffeeRatingSummaries((await store.read()).state)).toEqual({});
    expect(await save(store)).toEqual({ average: 4, count: 1 });
    expect(await save(store)).toEqual({ average: 4, count: 1 });
    expect(await save(store, { ...input, score: 2 })).toEqual({ average: 2, count: 1 });
    expect(await save(store, { ...input, voterToken: randomUUID(), score: 5 }, 'other')).toEqual({ average: 3.5, count: 2 });
    const state = (await store.read()).state;
    expect(coffeeRatingSummaries(state)).toEqual({ [bar.id]: { average: 3.5, count: 2 } });
    expect(JSON.stringify(state)).not.toContain(input.voterToken);
    expect(JSON.stringify(coffeeRatingSummaries(state))).not.toContain('visitor');
  });
  it('preserves concurrent votes and unrelated state', async () => {
    const store = memoryStore();
    const initial = await store.read();
    initial.state.menuScans = { existing: { status: 'done', expires: 9000 } };
    await store.write(initial.state, initial.etag);
    await Promise.all([save(store), save(store, { ...input, voterToken: randomUUID(), score: 2 }, 'other')]);
    const { state } = await store.read();
    expect(coffeeRatingSummaries(state)[bar.id]).toEqual({ average: 3, count: 2 });
    expect(state.menuScans).toEqual(initial.state.menuScans);
  });
  it.each([null, {}, { ...input, score: 0 }, { ...input, score: 6 }, { ...input, score: 2.5 },
    { ...input, score: '5' }, { ...input, voterToken: 'anything' }, { ...input, barId: '__proto__' }])('rejects invalid ratings %j', async value => {
    const store = memoryStore();
    await expect(save(store, value)).rejects.toHaveProperty('status');
    expect(coffeeRatingSummaries((await store.read()).state)).toEqual({});
  });
  it('limits writes, allows an identical retry and fails honestly on unavailable storage', async () => {
    const store = memoryStore();
    for (let i = 0; i < 20; i++) await save(store, { ...input, score: i % 2 + 1 });
    expect(await save(store, { ...input, score: 2 })).toEqual({ average: 2, count: 1 });
    await expect(save(store)).rejects.toHaveProperty('status', 429);
    await expect(save(store, input, 'visitor', 3601001)).resolves.toEqual({ average: 4, count: 1 });
    const broken = memoryStore();
    broken.write = async () => { throw new Error('offline'); };
    await expect(save(broken)).rejects.toThrow('offline');
    expect(coffeeRatingSummaries((await broken.read()).state)).toEqual({});
  });
});
