import { expect, it } from 'vitest';
import { emptyState, WriteConflict, type Store } from '../server/prices';
import { withPriceCooldown, PRICE_WINDOW_MS } from '../server/price-cooldown';

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

it('limits both IP and browser independently, with no midnight or fixed-window reset', async () => {
  const store = memoryStore();
  for (let i = 0; i < 5; i++) await withPriceCooldown(store, 'ip-a', 'device-a', async () => i, now + i * 60_000);
  let saves = 0;
  const save = async () => ++saves;
  for (const [ip, device] of [['ip-a', 'new-device'], ['new-ip', 'device-a']]) {
    await expect(withPriceCooldown(store, ip, device, save, now + 5 * 60_000))
      .rejects.toMatchObject({ status: 429, retryAfter: 300 });
  }
  expect(saves).toBe(0);
  await expect(withPriceCooldown(store, 'ip-a', 'device-a', save, now + PRICE_WINDOW_MS - 1))
    .rejects.toMatchObject({ status: 429, retryAfter: 1 });
  // Only the oldest slot expires, not the whole window.
  await expect(withPriceCooldown(store, 'ip-a', 'device-a', save, now + PRICE_WINDOW_MS)).resolves.toBe(1);
  await expect(withPriceCooldown(store, 'ip-a', 'device-a', save, now + PRICE_WINDOW_MS))
    .rejects.toMatchObject({ status: 429, retryAfter: 60 });
  await expect(withPriceCooldown(store, 'other-ip', 'other-device', save, now + PRICE_WINDOW_MS)).resolves.toBe(2);
});

it('reserves the last slot atomically across simultaneous requests', async () => {
  const store = memoryStore();
  for (let i = 0; i < 4; i++) await withPriceCooldown(store, 'ip', 'device', async () => {}, now);
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
  for (let i = 0; i < 5; i++) await withPriceCooldown(store, 'ip', 'device', async () => {}, now);
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
