import { describe, expect, it } from 'vitest';
import { categoryCounts, emptyCategoryCounts, rankedCategories, streetfoodPriceCount } from '../src/categories';
import { CategoryWriteConflict, emptyCategoryState, popularityCounts, recordCategoryClick, type CategoryState, type CategoryStore } from '../server/category-popularity';

function memoryStore(initial = emptyCategoryState()): CategoryStore {
  let state = structuredClone(initial), revision = 0;
  return {
    async read() { return { state: structuredClone(state), etag: String(revision) }; },
    async write(next, etag) {
      if (etag !== String(revision)) throw new CategoryWriteConflict();
      state = structuredClone(next); revision++;
    },
  };
}
const now = Date.parse('2026-10-19T12:00:00Z');

it('counts only current positive prices in the requested food category', () => {
  expect(streetfoodPriceCount({ bars: [{ type: 'fast_food', offers: [
    { portionType: 'wrap', foodType: 'doner', priceChf: 12 },
    { portionType: 'wrap', foodType: 'doner', priceChf: 14 },
    { portionType: 'wrap', foodType: 'falafel', priceChf: 10 },
    { portionType: 'wrap', foodType: 'doner', priceChf: 0 },
    { portionType: 'wrap', foodType: 'doner', priceChf: -1 },
    { portionType: 'wrap', foodType: 'doner', priceChf: '12' },
    { portionType: 'wrap', foodType: 'doner', priceChf: Infinity },
    { portionType: 'wrap', foodType: 'doner', priceChf: 12, photoSource: { date: '2000-01-01' } },
    { foodType: 'doner', portionType: 'bread', priceChf: 12 },
    { foodType: 'doner', priceChf: 12 },
    null,
  ] }, { type: 'restaurant', offers: [{ foodType: 'doner', portionType: 'wrap', priceChf: 12 }] }, null, {}] }, 'doner')).toBe(2);
  for (const missing of [null, {}, { bars: {} }, '<html>Not found</html>']) {
    expect(streetfoodPriceCount(missing, 'falafel')).toBe(0);
  }
});

describe('shared category popularity', () => {
  it('keeps coffee first and ranks the remaining categories with stable ties', () => {
    expect(rankedCategories(emptyCategoryCounts())).toEqual(['coffee', 'beer', 'ramen', 'pizza', 'doner', 'falafel']);
    const counts = { coffee: 40, beer: 30, ramen: 0, pizza: 1, doner: 20, falafel: 0 };
    expect(rankedCategories(counts)).toEqual(['coffee', 'beer', 'doner', 'pizza', 'ramen', 'falafel']);
    expect(rankedCategories(counts, false)).toEqual(['coffee', 'beer', 'doner', 'ramen', 'falafel']);
    expect(rankedCategories(counts, true, false)).toEqual(['coffee', 'beer', 'doner', 'pizza', 'falafel']);
    const coffeeLeastPopular = { coffee: 0, beer: 100, ramen: 0, pizza: 200, doner: 300, falafel: 400 };
    expect(rankedCategories(coffeeLeastPopular)).toEqual(['coffee', 'falafel', 'doner', 'pizza', 'beer', 'ramen']);
    expect(rankedCategories(coffeeLeastPopular, false)).toEqual(['coffee', 'falafel', 'doner', 'beer', 'ramen']);
  });
  it('counts at most one click per visitor, category and UTC day across clients', async () => {
    const store = memoryStore();
    await recordCategoryClick(store, 'doner', 'visitor-a', now);
    await recordCategoryClick(store, 'doner', 'visitor-a', now);
    await recordCategoryClick(store, 'falafel', 'visitor-a', now);
    const counts = await recordCategoryClick(store, 'doner', 'visitor-b', now);
    expect(counts).toEqual({ coffee: 0, beer: 0, ramen: 0, pizza: 0, doner: 2, falafel: 1 });
    expect((await recordCategoryClick(store, 'doner', 'visitor-a', now + 86400000)).doner).toBe(3);
    expect((await store.read()).state.visitors).toEqual({ 'visitor-a': ['doner'] });
  });
  it('merges concurrent visitors without losing clicks and deduplicates concurrent retries', async () => {
    const store = memoryStore();
    await Promise.all(['a', 'b', 'a'].map(visitor => recordCategoryClick(store, 'doner', visitor, now)));
    expect(popularityCounts((await store.read()).state, now).doner).toBe(2);
  });
  it('expires old popularity after 30 calendar days and removes old visitor hashes', async () => {
    const state: CategoryState = { days: {
      '2026-09-19': { ...emptyCategoryCounts(), pizza: 100 },
      '2026-09-20': { ...emptyCategoryCounts(), coffee: 2 },
    }, visitorDay: '2026-10-18', visitors: { old: ['doner'] } };
    const store = memoryStore(state);
    expect(popularityCounts(state, now)).toEqual({ coffee: 2, beer: 0, ramen: 0, pizza: 0, doner: 0, falafel: 0 });
    await recordCategoryClick(store, 'falafel', 'new', now);
    const saved = (await store.read()).state;
    expect(saved.days).not.toHaveProperty('2026-09-19');
    expect(saved.visitors).toEqual({ new: ['falafel'] });
  });
  it('ignores malformed counts instead of breaking the menu', () => {
    expect(categoryCounts({ beer: -5, pizza: '900', doner: Infinity, falafel: 3 })).toEqual({ ...emptyCategoryCounts(), falafel: 3 });
  });
});
