import { createHmac } from 'node:crypto';
import { communityVenues, InputError } from '../src/community.js';
import type { CoffeeRating, CoffeeRatings } from '../src/coffee-rating-data.js';
import { WriteConflict, type State, type Store } from './prices.js';

export type CoffeeVotes = Record<string, Record<string, number>>;
export type CoffeeVoteDetails = Record<string, Record<string, { updatedAt: number; photoHash: string }>>;
export type CoffeePhotoProof = { owner: string; photoHash: string };

function summary(votes: Record<string, number>): CoffeeRating {
  const values = Object.values(votes);
  return { average: values.length < 3 ? null : values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length };
}

export function ratingVoter(city: string, barId: string, owner: string, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify(['browser', city, barId, owner])).digest('hex');
}

export function checkRatingChange(state: State, barId: string, voter: string, score: number, now: number) {
  const previous = state.coffeeVoteDetails?.[barId]?.[voter];
  if (previous && state.coffeeVotes?.[barId]?.[voter] !== score && now < previous.updatedAt + 43200000) {
    throw new InputError('Du kannst deine Bewertung für dieses Lokal erst nach 12 Stunden wieder ändern.', 429);
  }
}

export function coffeeRatingSummaries(state: State): CoffeeRatings {
  return Object.fromEntries(Object.entries(state.coffeeVotes || {})
    .filter(([, votes]) => Object.keys(votes).length)
    .map(([id, votes]) => [id, summary(votes)]));
}

export async function saveCoffeeRating(
  store: Store, value: unknown, datasets: Parameters<typeof communityVenues>[0],
  city: string, visitor: string, secret: string, now = Date.now(), proof?: CoffeePhotoProof,
) {
  const input = value as { barId?: unknown; score?: unknown; voterToken?: unknown } | null;
  if (!input || typeof input.barId !== 'string' || !input.barId || input.barId.length > 100 ||
    typeof input.score !== 'number' || !Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    throw new InputError('Bitte eine Bewertung von 1 bis 5 wählen.');
  }
  if (!proof?.owner || !/^[a-f0-9]{64}$/.test(proof.photoHash)) throw new InputError('Bitte ein Foto mit deinem Kaffee aus diesem Lokal hochladen.', 422);
  // Only server-created identities and a server-verified photo authorize a vote.
  const voter = ratingVoter(city, input.barId, proof.owner, secret);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const venue = communityVenues(datasets, state.entries, state.venues, state.venueCorrections).find(bar => bar.id === input.barId);
    // The coffee view also includes known venues without a recorded coffee price.
    if (!venue) throw new InputError('Dieses Lokal ist nicht mehr verfügbar. Bitte neu laden.');
    const votes = state.coffeeVotes?.[input.barId] || {};
    const used = state.coffeePhotoUses?.[proof.photoHash];
    if (used && (used.voter !== voter || used.barId !== input.barId)) throw new InputError('Dieses Foto wurde bereits für eine Bewertung verwendet. Bitte ein eigenes Kaffeefoto hochladen.', 422);
    checkRatingChange(state, input.barId, voter, input.score, now);
    if (votes[voter] === input.score) return summary(votes);
    state.limits = Object.fromEntries(Object.entries(state.limits).filter(([, limit]) => limit.expires > now));
    const key = `coffee-rating:${visitor}`;
    const limit = state.limits[key] || { count: 0, expires: now + 3600000 };
    if (limit.count >= 40) throw new InputError('Zu viele Einträge. Bitte in einer Stunde erneut versuchen.', 429);
    state.limits[key] = { ...limit, count: limit.count + 1 };
    const next = { ...votes, [voter]: input.score };
    state.coffeeVotes = { ...state.coffeeVotes, [input.barId]: next };
    state.coffeeVoteDetails = { ...state.coffeeVoteDetails, [input.barId]: {
      ...state.coffeeVoteDetails?.[input.barId], [voter]: { updatedAt: now, photoHash: proof.photoHash },
    } };
    state.coffeePhotoUses = { ...state.coffeePhotoUses, [proof.photoHash]: { voter, barId: input.barId } };
    try { await store.write(state, etag); return summary(next); }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden mehrere Bewertungen gespeichert. Bitte erneut versuchen.', 409);
}
