import { createHmac } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import type { City } from '../src/cities.js';

export type ValueRating = { average: number | null; count: number; mine: number | null };
export type ValueRatingState = {
  version: 1;
  // Votes are per visitor and day. Totals are kept for good.
  day: string;
  totals: Record<string, { sum: number; count: number }>;
  votes: Record<string, Record<string, number>>;
};
export type ValueRatingStore = {
  read(): Promise<{ state: ValueRatingState; etag?: string }>;
  write(state: ValueRatingState, etag?: string): Promise<void>;
};
export class ValueRatingWriteConflict extends Error {}
export const emptyValueRatingState = (): ValueRatingState => ({ version: 1, day: '', totals: {}, votes: {} });

function validState(state: ValueRatingState): boolean {
  return state?.version === 1 && typeof state.day === 'string' && Boolean(state.totals) && typeof state.totals === 'object'
    && Boolean(state.votes) && typeof state.votes === 'object';
}

export function valueRatingStore(): ValueRatingStore {
  const path = `value-ratings/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`;
  return {
    async read() {
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: emptyValueRatingState() };
      if (result.statusCode !== 200) throw new Error('Unexpected rating storage response');
      const state = await new Response(result.stream).json() as ValueRatingState;
      if (!validState(state)) throw new Error('Invalid rating state');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false,
          allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new ValueRatingWriteConflict();
        throw error;
      }
    },
  };
}

// A daily, purpose-specific hash. No raw IP address is stored.
export function valueRatingVisitor(ip: string, today: string, secret: string): string {
  return createHmac('sha256', secret).update(`value-rating:${today}:${ip}`).digest('hex');
}

function summarize(state: ValueRatingState, key: string, visitor: string, today: string): ValueRating {
  const total = state.totals[key];
  const mine = state.day === today ? state.votes[key]?.[visitor] : undefined;
  return { average: total?.count ? total.sum / total.count : null, count: total?.count ?? 0, mine: mine ?? null };
}

export async function readValueRating(store: ValueRatingStore, key: string, visitor: string, today: string): Promise<ValueRating> {
  const { state } = await store.read();
  return summarize(state, key, visitor, today);
}

// A repeated vote on the same day replaces the earlier one.
export async function voteValueRating(store: ValueRatingStore, key: string, visitor: string, stars: number, today: string): Promise<ValueRating> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag } = await store.read();
    if (state.day !== today) { state.day = today; state.votes = {}; }
    const previous = state.votes[key]?.[visitor];
    if (previous === stars) return summarize(state, key, visitor, today);
    const total = state.totals[key] || { sum: 0, count: 0 };
    state.totals[key] = previous === undefined
      ? { sum: total.sum + stars, count: total.count + 1 }
      : { sum: total.sum - previous + stars, count: total.count };
    state.votes[key] = { ...state.votes[key], [visitor]: stars };
    try {
      await store.write(state, etag);
      return summarize(state, key, visitor, today);
    } catch (error) {
      if (!(error instanceof ValueRatingWriteConflict)) throw error;
    }
  }
  throw new Error('Rating storage busy');
}

// Aggregates only: the review page never sees individual or daily votes.
export function valueRatingOverview(state: ValueRatingState, venues: Map<string, { name: string; address: string }>) {
  return Object.entries(state.totals)
    .filter(([, total]) => total.count > 0)
    .map(([key, total]) => {
      const separator = key.indexOf(':');
      const city = key.slice(0, separator) as City, barId = key.slice(separator + 1);
      const venue = venues.get(key);
      return { city, barId, venueName: venue?.name ?? barId, address: venue?.address ?? '', average: total.sum / total.count, count: total.count };
    })
    .sort((a, b) => b.count - a.count || a.venueName.localeCompare(b.venueName, 'de-CH'));
}

// Takes back the visitor's vote for today. Totals drop by that vote.
export async function removeValueRating(store: ValueRatingStore, key: string, visitor: string, today: string): Promise<ValueRating> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag } = await store.read();
    const previous = state.day === today ? state.votes[key]?.[visitor] : undefined;
    if (previous === undefined) return summarize(state, key, visitor, today);
    const total = state.totals[key];
    state.totals[key] = { sum: total.sum - previous, count: total.count - 1 };
    delete state.votes[key][visitor];
    if (!Object.keys(state.votes[key]).length) delete state.votes[key];
    try {
      await store.write(state, etag);
      return summarize(state, key, visitor, today);
    } catch (error) {
      if (!(error instanceof ValueRatingWriteConflict)) throw error;
    }
  }
  throw new Error('Rating storage busy');
}
