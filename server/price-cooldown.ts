import { randomUUID } from 'node:crypto';
import { InputError } from '../src/community.js';
import { WriteConflict, type Store } from './prices.js';

export type PriceCooldowns = Record<string, { id: string; at: number }[]>;
export const PRICE_WINDOW_MS = 10 * 60 * 1000;
export const PRICE_WINDOW_LIMIT = 5;

export class PriceCooldownError extends InputError {
  constructor(public retryAfter: number) {
    super('Zu viele Preisänderungen. Bitte kurz warten und erneut versuchen.', 429);
  }
}

async function reserve(store: Store, keys: string[], id: string, now: number) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    const active = Object.fromEntries(Object.entries(state.priceCooldowns || {})
      .map(([key, entries]) => [key, entries.filter(entry => entry.at > now - PRICE_WINDOW_MS)] as const)
      .filter(([, entries]) => entries.length));
    const waits = keys.filter(key => (active[key]?.length || 0) >= PRICE_WINDOW_LIMIT)
      .map(key => Math.min(...active[key].map(entry => entry.at)) + PRICE_WINDOW_MS - now);
    if (waits.length) throw new PriceCooldownError(Math.max(1, Math.ceil(Math.max(...waits) / 1000)));
    for (const key of keys) active[key] = [...(active[key] || []), { id, at: now }];
    state.priceCooldowns = active;
    try { await store.write(state, etag); return; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden mehrere Preise gespeichert. Bitte erneut versuchen.', 409);
}

async function release(store: Store, keys: string[], id: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, etag } = await store.read();
    for (const key of keys) {
      if (!state.priceCooldowns?.[key]) continue;
      state.priceCooldowns[key] = state.priceCooldowns[key].filter(entry => entry.id !== id);
      if (!state.priceCooldowns[key].length) delete state.priceCooldowns[key];
    }
    try { await store.write(state, etag); return; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new WriteConflict();
}

// One shared quota store for all cities and categories. Reserve before writing so
// simultaneous requests cannot exceed the limit; failed edits refund their slot.
export async function withPriceCooldown<T>(store: Store, ip: string, device: string, save: () => Promise<T>, now = Date.now()): Promise<T> {
  const keys = [`ip:${ip}`, `device:${device}`], id = randomUUID();
  await reserve(store, keys, id, now);
  try { return await save(); }
  catch (error) {
    try { await release(store, keys, id); }
    catch { console.error('Price cooldown reservation could not be released'); }
    throw error;
  }
}
