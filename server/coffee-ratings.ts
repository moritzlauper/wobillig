import { createHmac } from 'node:crypto';
import { communityVenues, InputError } from '../src/community.js';
import type { CoffeeRating, CoffeeRatings } from '../src/coffee-rating-data.js';
import { WriteConflict, type State, type Store } from './prices.js';

export type CoffeeVotes = Record<string, Record<string, number>>;

function summary(votes: Record<string, number>): CoffeeRating {
  const values = Object.values(votes);
  return { average: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length };
}

export function coffeeRatingSummaries(state: State): CoffeeRatings {
  return Object.fromEntries(Object.entries(state.coffeeVotes || {})
    .filter(([, votes]) => Object.keys(votes).length)
    .map(([id, votes]) => [id, summary(votes)]));
}

export async function saveCoffeeRating(
  store: Store, value: unknown, datasets: Parameters<typeof communityVenues>[0],
  city: string, visitor: string, secret: string, now = Date.now(),
) {
  const input = value as { barId?: unknown; score?: unknown; voterToken?: unknown } | null;
  if (!input || typeof input.barId !== 'string' || !input.barId || input.barId.length > 100 ||
    typeof input.score !== 'number' || !Number.isInteger(input.score) || input.score < 1 || input.score > 5 ||
    typeof input.voterToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.voterToken)) {
    throw new InputError('Bitte eine Bewertung von 1 bis 5 wählen.');
  }
  // Scope anonymous identities to this venue; never publish tokens or vote records.
  const voter = createHmac('sha256', secret).update(JSON.stringify([city, input.barId, input.voterToken.toLowerCase()])).digest('hex');
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const venue = communityVenues(datasets, state.entries, state.venues).find(bar => bar.id === input.barId);
    // The coffee view also includes known venues without a recorded coffee price.
    if (!venue) throw new InputError('Dieses Lokal ist nicht mehr verfügbar. Bitte neu laden.');
    const votes = state.coffeeVotes?.[input.barId] || {};
    if (votes[voter] === input.score) return summary(votes);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const key = `coffee-rating:${visitor}`;
    const limit = state.limits[key] || { count: 0, expires: now + 3600000 };
    if (limit.count >= 20) throw new InputError('Zu viele Einträge. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[key] = { ...limit, count: limit.count + 1 };
    const next = { ...votes, [voter]: input.score };
    state.coffeeVotes = { ...state.coffeeVotes, [input.barId]: next };
    try { await store.write(state, etag); return summary(next); }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden mehrere Bewertungen gespeichert. Bitte erneut versuchen.', 409);
}
