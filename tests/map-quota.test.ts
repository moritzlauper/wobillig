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
  await expect(withMapQuota(store, 'create', 'ip', 'new-browser', 'bern:two', save, now + 120000)).rejects.toMatchObject({ status: 429 });
  await expect(withMapQuota(store, 'create', 'new-ip', 'browser', 'basel:two', save, now + 120000)).rejects.toMatchObject({ status: 429 });
  await withMapQuota(store, 'publish', 'ip', 'browser', 'zurich:one', save, now);
  await expect(withMapQuota(store, 'publish', 'ip', 'new-browser', 'bern:two', save, now + 1)).rejects.toMatchObject({ status: 429 });
  await expect(withMapQuota(store, 'publish', 'new-ip', 'browser', 'basel:two', save, now + 1)).rejects.toMatchObject({ status: 429 });
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'bern:two', save, now + 86400000)).resolves.toBe('saved');
});
it('reserves atomically for simultaneous attempts and refunds failed writes', async () => {
  const store = memory();
  const results = await Promise.allSettled([
    withMapQuota(store, 'create', 'ip', 'a', 'one', save, 1000),
    withMapQuota(store, 'create', 'ip', 'b', 'two', save, 1000),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await expect(withMapQuota(store, 'publish', 'ip', 'a', 'one', async () => { throw new Error('invalid'); }, 1000)).rejects.toThrow('invalid');
  await expect(withMapQuota(store, 'publish', 'ip', 'a', 'one', save, 1000)).resolves.toBe('saved');
});
