import { expect, it } from 'vitest';
import { emptyState, WriteConflict, type Store } from '../server/prices';
import { withPriceCooldown, PRICE_WINDOW_MS, PRICE_WINDOW_LIMIT, PRICE_IP_WINDOW_LIMIT } from '../server/price-cooldown';

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
const now = Date.parse('2026-10-20T23:58:00Z');

for (const sharedIp of [false, true]) {
  it(`enforces the rolling ${sharedIp ? 'shared IP' : 'browser'} allowance independently`, async () => {
    const store = memoryStore(), limit = sharedIp ? PRICE_IP_WINDOW_LIMIT : PRICE_WINDOW_LIMIT;
    const step = 300000 / limit;
    for (let i = 0; i < limit; i++) await withPriceCooldown(store, 'ip-a', sharedIp ? `device-${i}` : 'device-a', async () => i, now + i * step);
    let saves = 0;
    const save = async () => ++saves;
    const ip = sharedIp ? 'ip-a' : 'new-ip', device = sharedIp ? 'new-device' : 'device-a';
    await expect(withPriceCooldown(store, ip, device, save, now + 300000)).rejects.toMatchObject({ status: 429, retryAfter: 300 });
    await expect(withPriceCooldown(store, ip, device, save, now + PRICE_WINDOW_MS - 1)).rejects.toMatchObject({ status: 429, retryAfter: 1 });
    expect(saves).toBe(0);
    await expect(withPriceCooldown(store, ip, device, save, now + PRICE_WINDOW_MS)).resolves.toBe(1);
    await expect(withPriceCooldown(store, ip, device, save, now + PRICE_WINDOW_MS)).rejects.toMatchObject({ status: 429, retryAfter: step / 1000 });
    await expect(withPriceCooldown(store, 'other-ip', 'other-device', save, now + PRICE_WINDOW_MS)).resolves.toBe(2);
  });
}
it('allows another person on a shared IP after the first browser reaches its limit', async () => {
  const store = memoryStore();
  for (let i = 0; i < PRICE_WINDOW_LIMIT; i++) await withPriceCooldown(store, 'shared', 'first', async () => {}, now);
  await expect(withPriceCooldown(store, 'shared', 'second', async () => 'saved', now)).resolves.toBe('saved');
});

it('reserves the last slot atomically across simultaneous requests', async () => {
  const store = memoryStore();
  for (let i = 0; i < PRICE_WINDOW_LIMIT - 1; i++) await withPriceCooldown(store, 'ip', 'device', async () => {}, now);
  let saves = 0;
  const results = await Promise.allSettled([1, 2].map(() => withPriceCooldown(store, 'ip', 'device', async () => ++saves, now)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 429 } });
  expect(saves).toBe(1);
});

it('refunds failed writes without removing other reservations and prunes expired identifiers', async () => {
  const store = memoryStore();
  const error = new Error('Storage offline');
  await expect(withPriceCooldown(store, 'ip', 'device', async () => { throw error; }, now)).rejects.toBe(error);
  expect((await store.read()).state.priceCooldowns).toEqual({});
  for (let i = 0; i < PRICE_WINDOW_LIMIT; i++) await withPriceCooldown(store, 'ip', 'device', async () => {}, now);
  await withPriceCooldown(store, 'fresh-ip', 'fresh-device', async () => {}, now + PRICE_WINDOW_MS);
  expect(Object.keys((await store.read()).state.priceCooldowns!).sort()).toEqual(['device:fresh-device', 'ip:fresh-ip']);
});

it('does not save a price if quota storage fails', async () => {
  const store = memoryStore();
  store.write = async () => { throw new Error('Offline'); };
  let saved = false;
  await expect(withPriceCooldown(store, 'ip', 'device', async () => { saved = true; }, now)).rejects.toThrow('Offline');
  expect(saved).toBe(false);
});
