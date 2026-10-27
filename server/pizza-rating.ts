import { createHmac } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

export type PizzaRating = { average: number | null; count: number; mine: number | null };
export type PizzaRatingState = {
  version: 1;
  // Votes are per visitor and day. Totals are kept for good.
  day: string;
  totals: Record<string, { sum: number; count: number }>;
  votes: Record<string, Record<string, number>>;
};
export type PizzaRatingStore = {
  read(): Promise<{ state: PizzaRatingState; etag?: string }>;
  write(state: PizzaRatingState, etag?: string): Promise<void>;
};
export class PizzaRatingWriteConflict extends Error {}
export const emptyPizzaRatingState = (): PizzaRatingState => ({ version: 1, day: '', totals: {}, votes: {} });

function validState(state: PizzaRatingState): boolean {
  return state?.version === 1 && typeof state.day === 'string' && Boolean(state.totals) && typeof state.totals === 'object'
    && Boolean(state.votes) && typeof state.votes === 'object';
}

export function pizzaRatingStore(): PizzaRatingStore {
  const path = `pizza-ratings/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`;
  return {
    async read() {
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: emptyPizzaRatingState() };
      if (result.statusCode !== 200) throw new Error('Unexpected rating storage response');
      const state = await new Response(result.stream).json() as PizzaRatingState;
      if (!validState(state)) throw new Error('Invalid rating state');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false,
          allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new PizzaRatingWriteConflict();
        throw error;
      }
    },
  };
}

// A daily, purpose-specific hash. No raw IP address is stored.
export function pizzaRatingVisitor(ip: string, today: string, secret: string): string {
  return createHmac('sha256', secret).update(`pizza-rating:${today}:${ip}`).digest('hex');
}

function summarize(state: PizzaRatingState, key: string, visitor: string, today: string): PizzaRating {
  const total = state.totals[key];
  const mine = state.day === today ? state.votes[key]?.[visitor] : undefined;
  return { average: total?.count ? total.sum / total.count : null, count: total?.count ?? 0, mine: mine ?? null };
}

export async function readPizzaRating(store: PizzaRatingStore, key: string, visitor: string, today: string): Promise<PizzaRating> {
  const { state } = await store.read();
  return summarize(state, key, visitor, today);
}

// A repeated vote on the same day replaces the earlier one.
export async function votePizzaRating(store: PizzaRatingStore, key: string, visitor: string, stars: number, today: string): Promise<PizzaRating> {
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
      if (!(error instanceof PizzaRatingWriteConflict)) throw error;
    }
  }
  throw new Error('Rating storage busy');
}
