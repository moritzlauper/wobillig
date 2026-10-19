import { expect, it, vi } from 'vitest';
import { cachedGoogleRating, emptyRatingState, googleBillingMonth, GOOGLE_RATING_CACHE_MS, RatingWriteConflict, type RatingState, type RatingStore } from '../server/google-rating-cache';
const start = Date.parse('2026-10-19T12:00:00Z');
const rating = { rating: 4.7, reviewCount: 200, mapsUrl: 'https://maps.google.com/?cid=123', attributions: [] };
function memoryStore(initial = emptyRatingState()) {
  let state = structuredClone(initial), revision = 0;
  const store: RatingStore = {
    async read() { return { state: structuredClone(state), etag: String(revision) }; },
    async write(next, etag) {
      if (etag !== String(revision)) throw new RatingWriteConflict();
      state = structuredClone(next); revision++;
    },
  };
  return { store, state: () => structuredClone(state) };
}
it('shares a seven-day cache between visitors and refreshes at expiry', async () => {
  const { store, state } = memoryStore();
  const fetch = vi.fn().mockResolvedValue(rating);
  expect(await cachedGoogleRating(store, 'zurich:a', fetch, () => start)).toEqual(rating);
  expect(await cachedGoogleRating(store, 'zurich:a', fetch, () => start + GOOGLE_RATING_CACHE_MS - 1)).toEqual(rating);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state().used).toBe(1);
  await cachedGoogleRating(store, 'zurich:a', fetch, () => start + GOOGLE_RATING_CACHE_MS);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(state().used).toBe(2);
});
it('also caches a confirmed missing rating instead of paying for repeated misses', async () => {
  const { store } = memoryStore();
  const fetch = vi.fn().mockResolvedValue(null);
  await cachedGoogleRating(store, 'basel:a', fetch, () => start);
  expect(await cachedGoogleRating(store, 'basel:a', fetch, () => start + 1000)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('allows exactly one of many concurrent requests to use slot 1000', async () => {
  const { store, state } = memoryStore({ ...emptyRatingState(), month: '2026-10', used: 999 });
  const fetch = vi.fn().mockResolvedValue(rating);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => cachedGoogleRating(store, `zurich:${i}`, fetch, () => start)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state().used).toBe(1000);
});
it('deduplicates a venue across instances while its reserved request is running', async () => {
  const { store, state } = memoryStore();
  let finish!: (value: typeof rating) => void;
  const fetch = vi.fn(() => new Promise<typeof rating>(resolve => { finish = resolve; }));
  const first = cachedGoogleRating(store, 'zurich:a', fetch, () => start);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(await cachedGoogleRating(store, 'zurich:a', fetch, () => start)).toBeNull();
  finish(rating); await first;
  expect(await cachedGoogleRating(store, 'zurich:a', fetch, () => start)).toEqual(rating);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state().used).toBe(1);
});
it('serves fresh cache at the cap but never stale ratings or new Google calls', async () => {
  const { store } = memoryStore({ ...emptyRatingState(), month: '2026-10', used: 1000,
    cache: { fresh: { fetchedAt: start, rating }, expired: { fetchedAt: start - GOOGLE_RATING_CACHE_MS, rating } } });
  const fetch = vi.fn();
  expect(await cachedGoogleRating(store, 'fresh', fetch, () => start)).toEqual(rating);
  expect(await cachedGoogleRating(store, 'expired', fetch, () => start)).toBeNull();
  expect(await cachedGoogleRating(store, 'missing', fetch, () => start)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('resets the quota at the Pacific billing month, retaining valid cached data', async () => {
  expect(googleBillingMonth(Date.parse('2026-06-01T06:59:59Z'))).toBe('2026-05');
  expect(googleBillingMonth(Date.parse('2026-06-01T07:00:00Z'))).toBe('2026-06');
  const boundary = Date.parse('2027-01-01T08:00:00Z');
  const { store, state } = memoryStore({ ...emptyRatingState(), month: '2026-12', used: 1000, cache: { saved: { fetchedAt: boundary - 100000, rating } } });
  const fetch = vi.fn().mockResolvedValue(rating);
  expect(await cachedGoogleRating(store, 'new', fetch, () => boundary - 1)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(await cachedGoogleRating(store, 'new', fetch, () => boundary)).toEqual(rating);
  expect(state().month).toBe('2027-01'); expect(state().used).toBe(1);
  expect(await cachedGoogleRating(store, 'saved', fetch, () => boundary)).toEqual(rating);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not refund uncertain or failed Google requests and recovers an abandoned lease', async () => {
  const { store, state } = memoryStore();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(rating);
  await expect(cachedGoogleRating(store, 'a', fetch, () => start)).rejects.toThrow('timeout');
  expect(state().used).toBe(1);
  expect(await cachedGoogleRating(store, 'a', fetch, () => start + 1000)).toBeNull();
  await cachedGoogleRating(store, 'a', fetch, () => start + 31000);
  expect(state().used).toBe(2); expect(fetch).toHaveBeenCalledTimes(2);
});
it('never calls Google when storage fails, is corrupt, or cannot reserve a slot', async () => {
  const fetch = vi.fn();
  const unreadable: RatingStore = { read: async () => { throw new Error('offline'); }, write: vi.fn() };
  await expect(cachedGoogleRating(unreadable, 'a', fetch, () => start)).rejects.toThrow();
  const corrupt = memoryStore({ ...emptyRatingState(), used: NaN } as RatingState).store;
  await expect(cachedGoogleRating(corrupt, 'a', fetch, () => start)).rejects.toThrow();
  const unwritable = memoryStore().store;
  unwritable.write = async () => { throw new Error('offline'); };
  await expect(cachedGoogleRating(unwritable, 'a', fetch, () => start)).rejects.toThrow();
  unwritable.write = async () => { throw new RatingWriteConflict(); };
  await expect(cachedGoogleRating(unwritable, 'a', fetch, () => start)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('does not spend a reservation in another month or roll a newer counter backwards', async () => {
  const now = Date.parse('2026-06-01T07:00:00Z');
  const { store } = memoryStore();
  const fetch = vi.fn();
  let time = now - 20000;
  const write = store.write;
  store.write = async (state, etag) => { await write(state, etag); time = now; };
  expect(await cachedGoogleRating(store, 'a', fetch, () => time)).toBeNull();
  const ahead = memoryStore({ ...emptyRatingState(), month: '2026-07', used: 999 }).store;
  expect(await cachedGoogleRating(ahead, 'a', fetch, () => now)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps the slot consumed when caching the response fails', async () => {
  const { store, state } = memoryStore();
  const write = store.write; let writes = 0;
  store.write = async (value, etag) => { if (++writes > 1) throw new Error('offline'); await write(value, etag); };
  const fetch = vi.fn().mockResolvedValue(rating);
  await expect(cachedGoogleRating(store, 'a', fetch, () => start)).rejects.toThrow('offline');
  expect(state().used).toBe(1); expect(fetch).toHaveBeenCalledTimes(1);
});
