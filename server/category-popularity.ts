import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { categories, categoryCounts, emptyCategoryCounts, type Category, type CategoryCounts } from '../src/categories.js';

export type CategoryState = { days: Record<string, CategoryCounts>; visitorDay: string; visitors: Record<string, Category[]> };
export type CategoryStore = { read(): Promise<{ state: CategoryState; etag?: string }>; write(state: CategoryState, etag?: string): Promise<void> };
export const emptyCategoryState = (): CategoryState => ({ days: {}, visitorDay: '', visitors: {} });
export class CategoryWriteConflict extends Error {}
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const cutoff = (now: number) => dayKey(now - 29 * 86400000);

export function popularityCounts(state: CategoryState, now = Date.now()): CategoryCounts {
  const result = emptyCategoryCounts();
  for (const [day, value] of Object.entries(state.days)) {
    if (day < cutoff(now) || day > dayKey(now)) continue;
    const counts = categoryCounts(value);
    for (const category of categories) result[category] += counts[category];
  }
  return result;
}

export function categoryStore(): CategoryStore {
  const path = `categories/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`;
  return {
    async read() {
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: emptyCategoryState() };
      if (result.statusCode !== 200) throw new Error('Unexpected category storage response');
      const state = await new Response(result.stream).json() as CategoryState;
      if (!state.days || !state.visitors || typeof state.visitorDay !== 'string') throw new Error('Invalid category state');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new CategoryWriteConflict();
        throw error;
      }
    },
  };
}

export async function recordCategoryClick(store: CategoryStore, category: Category, visitor: string, now = Date.now()) {
  const today = dayKey(now);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag } = await store.read();
    state.days = Object.fromEntries(Object.entries(state.days).filter(([day]) => day >= cutoff(now) && day <= today));
    if (state.visitorDay !== today) { state.visitorDay = today; state.visitors = {}; }
    const clicked = state.visitors[visitor] || [];
    if (clicked.includes(category)) return popularityCounts(state, now);
    state.visitors[visitor] = [...clicked, category];
    const counts = categoryCounts(state.days[today]);
    counts[category]++;
    state.days[today] = counts;
    try { await store.write(state, etag); return popularityCounts(state, now); }
    catch (error) { if (!(error instanceof CategoryWriteConflict)) throw error; }
  }
  throw new Error('Category write conflict');
}
