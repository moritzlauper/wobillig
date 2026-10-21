import { expect, it } from 'vitest';
import { withMapQuota } from '../server/map-quota';
import { emptyState, WriteConflict, type Store } from '../server/prices';

function memory(): Store {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
}
const save = async () => 'saved';
it('enforces both identities across cities for a rolling day, with a separate publication allowance', async () => {
  const store = memory(), now = Date.parse('2026-10-20T23:59:00Z');
  await withMapQuota(store, 'create', 'ip', 'browser', 'zurich:one', save, now);
  for (let i = 1; i < 5; i++) await withMapQuota(store, 'create', 'ip', 'browser', `bern:${i}`, save, now + 60000);
  await expect(withMapQuota(store, 'create', 'ip', 'new-browser', 'bern:two', save, now + 120000)).rejects.toMatchObject({ status: 429 });
  await expect(withMapQuota(store, 'create', 'new-ip', 'browser', 'basel:two', save, now + 120000)).rejects.toMatchObject({ status: 429 });
  await withMapQuota(store, 'publish', 'ip', 'browser', 'zurich:one', save, now);
  await expect(withMapQuota(store, 'publish', 'ip', 'new-browser', 'bern:two', save, now + 1)).rejects.toMatchObject({ status: 429 });
  await expect(withMapQuota(store, 'publish', 'new-ip', 'browser', 'basel:two', save, now + 1)).rejects.toMatchObject({ status: 429 });
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'bern:two', save, now + 86400000)).resolves.toBe('saved');
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'basel:three', save, now + 86400001)).rejects.toMatchObject({ status: 429 });
});
it('reserves atomically for simultaneous attempts and refunds failed writes', async () => {
  const store = memory();
  for (let i = 0; i < 4; i++) await withMapQuota(store, 'create', 'ip', 'browser', `map:${i}`, save, 1000);
  const results = await Promise.allSettled([
    withMapQuota(store, 'create', 'ip', 'a', 'one', save, 1000),
    withMapQuota(store, 'create', 'ip', 'b', 'two', save, 1000),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await expect(withMapQuota(store, 'publish', 'ip', 'a', 'one', async () => { throw new Error('invalid'); }, 1000)).rejects.toThrow('invalid');
  await expect(withMapQuota(store, 'publish', 'ip', 'a', 'one', save, 1000)).resolves.toBe('saved');
});

it('counts existing single-slot reservations as one of five maps', async () => {
  const store = memory();
  const { state, etag } = await store.read();
  const old = { id: 'legacy', operation: 'zurich:old', expires: 86401000, done: true };
  state.mapQuotas = { 'create:ip:ip': old, 'create:browser:browser': old };
  await store.write(state, etag);
  for (let i = 0; i < 4; i++) await withMapQuota(store, 'create', 'ip', 'browser', `new:${i}`, save, 1000);
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'sixth', save, 1000)).rejects.toMatchObject({ status: 429 });
});

it('refunds only the failed creation while preserving other reservations', async () => {
  const store = memory();
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'failed', async () => {
    await withMapQuota(store, 'create', 'ip', 'browser', 'successful', save, 1000);
    throw new Error('save failed');
  }, 1000)).rejects.toThrow('save failed');
  for (let i = 0; i < 4; i++) await withMapQuota(store, 'create', 'ip', 'browser', `new:${i}`, save, 1000);
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'sixth', save, 1000)).rejects.toMatchObject({ status: 429 });
});
