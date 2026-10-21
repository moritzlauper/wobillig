import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
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
const save = (store: Store, value: unknown = input, owner = 'visitor', now = 1000, photo = owner) =>
  saveCoffeeRating(store, value, data, 'zurich', owner, 'test-secret', now,
    { owner, photoHash: createHash('sha256').update(photo).digest('hex') });

describe('shared coffee ratings', () => {
  it('hides the average before three votes and ignores client identity tokens', async () => {
    const store = memoryStore();
    expect(coffeeRatingSummaries((await store.read()).state)).toEqual({});
    expect(await save(store)).toEqual({ average: null, count: 1 });
    expect(await save(store, { ...input, voterToken: randomUUID() })).toEqual({ average: null, count: 1 });
    expect(await save(store, { ...input, score: 2 }, 'second')).toEqual({ average: null, count: 2 });
    expect(await save(store, { ...input, score: 3 }, 'third')).toEqual({ average: 3, count: 3 });
    const state = (await store.read()).state;
    expect(JSON.stringify(state)).not.toContain(input.voterToken);
    expect(JSON.stringify(coffeeRatingSummaries(state))).not.toContain('visitor');
  });
  it('allows a retry but waits 12 hours before changing a vote, including races', async () => {
    const store = memoryStore();
    await save(store);
    expect(await save(store)).toEqual({ average: null, count: 1 });
    await expect(save(store, { ...input, score: 2 }, 'visitor', 43200999)).rejects.toHaveProperty('status', 429);
    expect(await save(store, { ...input, score: 2 }, 'visitor', 43201000)).toEqual({ average: null, count: 1 });
    const fresh = memoryStore();
    const outcomes = await Promise.allSettled([save(fresh), save(fresh, { ...input, score: 2 })]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  });
  it('preserves concurrent votes and unrelated state', async () => {
    const store = memoryStore();
    const initial = await store.read();
    initial.state.menuScans = { existing: { status: 'done', expires: 9000 } };
    await store.write(initial.state, initial.etag);
    await Promise.all([save(store), save(store, { ...input, score: 2 }, 'other')]);
    const { state } = await store.read();
    expect(coffeeRatingSummaries(state)[bar.id]).toEqual({ average: null, count: 2 });
    expect(state.menuScans).toEqual(initial.state.menuScans);
  });
  it.each([null, {}, { ...input, score: 0 }, { ...input, score: 6 }, { ...input, score: 2.5 },
    { ...input, score: '5' }, { ...input, barId: '__proto__' }])('rejects invalid ratings %j', async value => {
    const store = memoryStore();
    await expect(save(store, value)).rejects.toHaveProperty('status');
    expect(coffeeRatingSummaries((await store.read()).state)).toEqual({});
  });
  it('requires server proof and prevents identical photos being reused by another browser or venue', async () => {
    const store = memoryStore();
    await expect(saveCoffeeRating(store, input, data, 'zurich', 'visitor', 'secret')).rejects.toHaveProperty('status', 422);
    await save(store);
    await expect(save(store, input, 'other', 1000, 'visitor')).rejects.toHaveProperty('status', 422);
    await expect(save(store, { ...input, barId: coffee.bars[1].id }, 'visitor')).rejects.toHaveProperty('status', 422);
    const broken = memoryStore();
    broken.write = async () => { throw new Error('offline'); };
    await expect(save(broken)).rejects.toThrow('offline');
    expect(coffeeRatingSummaries((await broken.read()).state)).toEqual({});
  });
});
