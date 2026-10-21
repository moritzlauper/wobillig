import { randomUUID } from 'node:crypto';
import { InputError } from '../src/community.js';
import { WriteConflict, type Store } from './prices.js';

export type MapQuotas = Record<string, { id: string; operation: string; expires: number; done: boolean }>;
const DAY = 86400000;
export const MAP_DAILY_LIMITS = { create: { ip: 30, browser: 10 }, publish: { ip: 9, browser: 3 } } as const;
export async function withMapQuota<T>(store: Store, action: 'create' | 'publish', ip: string, browser: string, operation: string, save: () => Promise<T>, now = Date.now()): Promise<T> {
  const prefixes = [`${action}:ip:${ip}`, `${action}:browser:${browser}`], id = randomUUID();
  const keys = prefixes.map(prefix => `${prefix}:${id}`);
  const limits = [MAP_DAILY_LIMITS[action].ip, MAP_DAILY_LIMITS[action].browser];
  let reserved = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    const quotas = Object.fromEntries(Object.entries(state.mapQuotas || {}).filter(([, quota]) => quota.expires > now));
    // Each reservation expires independently. Count old single-slot records too.
    const exhausted = prefixes.some((prefix, index) => Object.keys(quotas).filter(key => key === prefix || key.startsWith(`${prefix}:`)).length >= limits[index]);
    if (exhausted) {
      throw new InputError(action === 'create' ? 'Innerhalb von 24 Stunden sind höchstens 10 neue Maps pro Browser und 30 pro IP möglich.'
        : 'Innerhalb von 24 Stunden sind höchstens 3 Veröffentlichungseinreichungen pro Browser und 9 pro IP möglich.', 429);
    }
    for (const key of keys) quotas[key] = { id, operation, expires: now + DAY, done: false };
    state.mapQuotas = quotas;
    try { await store.write(state, etag); reserved = true; break; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  if (!reserved) throw new InputError('Die Map wird gerade geändert. Bitte erneut versuchen.', 409);
  async function finish(done: boolean) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state, etag } = await store.read();
      for (const key of keys) if (state.mapQuotas?.[key]?.id === id) {
        if (done) state.mapQuotas[key].done = true;
        else delete state.mapQuotas[key];
      }
      try { await store.write(state, etag); return; }
      catch (error) { if (!(error instanceof WriteConflict)) throw error; }
    }
    throw new WriteConflict();
  }
  let result: T;
  try { result = await save(); }
  catch (error) { try { await finish(false); } catch { console.error('Map quota release failed'); } throw error; }
  // If finalization fails, the reservation still enforces the daily limit.
  try { await finish(true); } catch { console.error('Map quota finalization failed'); }
  return result;
}
