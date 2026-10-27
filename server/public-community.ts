import { publicMapSummaries } from '../src/custom-map-data.js';
import type { Store } from './prices.js';
function select(state: Awaited<ReturnType<Store['read']>>['state']) {
  return { entries: state.entries, venues: state.venues || [], venueCorrections: state.venueCorrections || [], publicMaps: publicMapSummaries(state.customMaps || []) };
}
const cache = new Map<string, { expires: number; value: Promise<ReturnType<typeof select>> }>();
export function clearPublicCache() { cache.clear(); }
export function publicCommunity(key: string, store: Store, now = Date.now()) {
  const old = cache.get(key);
  if (old && old.expires > now) return old.value;
  const value = store.read().then(({ state }) => select(state));
  cache.set(key, { expires: now + 15000, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}
