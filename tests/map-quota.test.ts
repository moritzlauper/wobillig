import { expect, it } from 'vitest';
import { MAP_DAILY_LIMITS, withMapQuota } from '../server/map-quota';
import { emptyState, WriteConflict, type Store } from '../server/prices';

function memory(): Store {
  let state = emptyState(), version = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
}
const save = async () => 'saved';
for (const action of ['create', 'publish'] as const) for (const sharedIp of [false, true]) {
  it(`enforces rolling ${action} limits for ${sharedIp ? 'shared IPs' : 'browsers'} across cities`, async () => {
    const store = memory(), now = Date.parse('2026-10-20T23:59:00Z');
    const limit = MAP_DAILY_LIMITS[action][sharedIp ? 'ip' : 'browser'];
    for (let i = 0; i < limit; i++) await withMapQuota(store, action, 'ip', sharedIp ? `browser-${i}` : 'browser', `${i % 2 ? 'bern' : 'zurich'}:${i}`, save, now + (i ? 60000 : 0));
    const ip = sharedIp ? 'ip' : 'new-ip', browser = sharedIp ? 'new-browser' : 'browser';
    await expect(withMapQuota(store, action, ip, browser, 'blocked', save, now + 120000)).rejects.toMatchObject({ status: 429 });
    await expect(withMapQuota(store, action, ip, browser, 'expired', save, now + 86400000)).resolves.toBe('saved');
    await expect(withMapQuota(store, action, ip, browser, 'still-blocked', save, now + 86400001)).rejects.toMatchObject({ status: 429 });
  });
}
it('allows several people to create and publish maps on the same network', async () => {
  const store = memory();
  for (let i = 0; i < MAP_DAILY_LIMITS.create.browser; i++) await withMapQuota(store, 'create', 'shared', 'first', String(i), save, 1000);
  await expect(withMapQuota(store, 'create', 'shared', 'second', 'new', save, 1000)).resolves.toBe('saved');
  for (let i = 0; i < MAP_DAILY_LIMITS.publish.browser; i++) await withMapQuota(store, 'publish', 'shared', 'first', String(i), save, 1000);
  await expect(withMapQuota(store, 'publish', 'shared', 'second', 'new', save, 1000)).resolves.toBe('saved');
});
it('reserves atomically for simultaneous attempts and refunds failed writes', async () => {
  const store = memory();
  for (let i = 0; i < MAP_DAILY_LIMITS.create.browser - 1; i++) await withMapQuota(store, 'create', 'ip', 'browser', `map:${i}`, save, 1000);
  const results = await Promise.allSettled([
    withMapQuota(store, 'create', 'ip', 'browser', 'one', save, 1000),
    withMapQuota(store, 'create', 'ip', 'browser', 'two', save, 1000),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await expect(withMapQuota(store, 'publish', 'ip', 'a', 'one', async () => { throw new Error('invalid'); }, 1000)).rejects.toThrow('invalid');
  await expect(withMapQuota(store, 'publish', 'ip', 'browser', 'one', save, 1000)).resolves.toBe('saved');
});

it('counts existing single-slot reservations towards the new allowance', async () => {
  const store = memory();
  const { state, etag } = await store.read();
  const old = { id: 'legacy', operation: 'zurich:old', expires: 86401000, done: true };
  state.mapQuotas = { 'create:ip:ip': old, 'create:browser:browser': old };
  await store.write(state, etag);
  for (let i = 0; i < MAP_DAILY_LIMITS.create.browser - 1; i++) await withMapQuota(store, 'create', 'ip', 'browser', `new:${i}`, save, 1000);
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'excess', save, 1000)).rejects.toMatchObject({ status: 429 });
});

it('refunds only the failed creation while preserving other reservations', async () => {
  const store = memory();
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'failed', async () => {
    await withMapQuota(store, 'create', 'ip', 'browser', 'successful', save, 1000);
    throw new Error('save failed');
  }, 1000)).rejects.toThrow('save failed');
  for (let i = 0; i < MAP_DAILY_LIMITS.create.browser - 1; i++) await withMapQuota(store, 'create', 'ip', 'browser', `new:${i}`, save, 1000);
  await expect(withMapQuota(store, 'create', 'ip', 'browser', 'excess', save, 1000)).rejects.toMatchObject({ status: 429 });
});
