import { randomUUID } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import type { GoogleRating } from './google-rating.js';

export const GOOGLE_RATING_MONTHLY_LIMIT = 1000;
export const GOOGLE_RATING_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const leaseMs = 30000;
// Google resets its monthly free allowance at midnight Pacific time.
export function googleBillingMonth(now: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}

export type RatingState = {
  version: 1;
  month: string;
  used: number;
  cache: Record<string, { fetchedAt: number; rating: GoogleRating | null }>;
  pending: Record<string, { token: string; expiresAt: number }>;
};
export type RatingStore = {
  read(): Promise<{ state: RatingState; etag?: string }>;
  write(state: RatingState, etag?: string): Promise<void>;
};
export class RatingWriteConflict extends Error {}
export const emptyRatingState = (): RatingState => ({ version: 1, month: '', used: 0, cache: {}, pending: {} });

function validState(state: RatingState): boolean {
  return state?.version === 1 && (state.month === '' || /^\d{4}-\d{2}$/.test(state.month))
    && Number.isInteger(state.used) && state.used >= 0 && (state.month !== '' || state.used === 0)
    && Boolean(state.cache) && typeof state.cache === 'object' && !Array.isArray(state.cache)
    && Boolean(state.pending) && typeof state.pending === 'object' && !Array.isArray(state.pending);
}

export function googleRatingStore(): RatingStore {
  // Deliberately shared by local, preview and production when using this Blob
  // store: separate deployment counters would multiply the Google allowance.
  const path = 'google-ratings/state.json';
  return {
    async read() {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Rating storage unavailable');
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: emptyRatingState() };
      if (result.statusCode !== 200) throw new Error('Rating storage unavailable');
      const state = await new Response(result.stream).json() as RatingState;
      if (!validState(state) || !result.blob.etag) throw new Error('Invalid rating storage');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false,
          allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new RatingWriteConflict();
        throw error;
      }
    },
  };
}

export async function cachedGoogleRating(store: RatingStore, id: string, fetchRating: () => Promise<GoogleRating | null>, clock = Date.now): Promise<GoogleRating | null> {
  let reservation: { token: string; month: string; expiresAt: number } | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    if (!validState(state)) throw new Error('Invalid rating storage');
    const now = clock();
    const cached = state.cache[id];
    if (cached && Number.isFinite(cached.fetchedAt) && cached.fetchedAt <= now && now - cached.fetchedAt < GOOGLE_RATING_CACHE_MS) return cached.rating;
    if (state.pending[id]?.expiresAt > now) return null;
    const month = googleBillingMonth(now);
    // Fail closed if an instance's clock is behind the shared counter.
    if (state.month > month) return null;
    if (state.month !== month) { state.month = month; state.used = 0; }
    if (state.used >= GOOGLE_RATING_MONTHLY_LIMIT) return null;
    const token = randomUUID();
    state.cache = Object.fromEntries(Object.entries(state.cache).filter(([, entry]) => entry.fetchedAt <= now && now - entry.fetchedAt < GOOGLE_RATING_CACHE_MS));
    state.pending = Object.fromEntries(Object.entries(state.pending).filter(([, entry]) => entry.expiresAt > now));
    state.pending[id] = { token, expiresAt: now + leaseMs };
    state.used++;
    try {
      // Reserve quota atomically BEFORE sending a potentially billable request.
      await store.write(state, etag);
      reservation = { token, month, expiresAt: now + leaseMs };
      break;
    } catch (error) { if (!(error instanceof RatingWriteConflict)) throw error; }
  }
  if (!reservation) throw new Error('Rating storage busy');
  const now = clock();
  // Avoid sending a request charged to a different month than its reservation.
  if (now >= reservation.expiresAt || googleBillingMonth(now) !== reservation.month || googleBillingMonth(now + 15000) !== reservation.month) return null;

  // Failed requests and abandoned reservations still consume quota. Never retry
  // Google automatically or refund a slot whose billing outcome is uncertain.
  const rating = await fetchRating();
  const fetchedAt = clock();
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    if (!validState(state)) throw new Error('Invalid rating storage');
    if (state.pending[id]?.token !== reservation.token) return rating;
    state.cache[id] = { rating, fetchedAt };
    delete state.pending[id];
    try { await store.write(state, etag); return rating; }
    catch (error) { if (!(error instanceof RatingWriteConflict)) throw error; }
  }
  // The reserved slot remains consumed even if storing the result failed.
  throw new Error('Rating storage busy');
}
