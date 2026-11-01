import { describe, expect, it } from 'vitest';
import { categoryCounts, categoryPeriod, categoryPeriodStart, emptyCategoryCounts, featuredCategories, rankedCategories } from '../src/categories';
import { CategoryWriteConflict, emptyCategoryState, popularityCounts, rankingCounts, recordCategoryClick, type CategoryState, type CategoryStore } from '../server/category-popularity';

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

describe('shared category popularity', () => {
  it('keeps coffee first and ranks the remaining categories with stable ties', () => {
    expect(rankedCategories(emptyCategoryCounts())).toEqual(['coffee', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail', 'pizza', 'kebab']);
    const counts = { coffee: 40, beer: 30, ramen: 0, burger: 0, softdrink: 2, cocktail: 0, pizza: 1, kebab: 20 };
    expect(rankedCategories(counts)).toEqual(['coffee', 'beer', 'kebab', 'softdrink', 'pizza', 'ramen', 'burger', 'cocktail']);
    expect(rankedCategories(counts, new Set(['pizza']))).toEqual(['coffee', 'beer', 'kebab', 'softdrink', 'ramen', 'burger', 'cocktail']);
    expect(rankedCategories(counts, new Set(['ramen', 'softdrink']))).toEqual(['coffee', 'beer', 'kebab', 'pizza', 'burger', 'cocktail']);
    expect(rankedCategories(counts, new Set(['burger', 'cocktail']))).toEqual(['coffee', 'beer', 'kebab', 'softdrink', 'pizza', 'ramen']);
    const coffeeLeastPopular = { coffee: 0, beer: 100, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 200, kebab: 300 };
    expect(rankedCategories(coffeeLeastPopular)).toEqual(['coffee', 'kebab', 'pizza', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail']);
    expect(rankedCategories(coffeeLeastPopular, new Set(['pizza']))).toEqual(['coffee', 'kebab', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail']);
  });
  it('keeps coffee and pizza first and features the two most clicked others, rotating the fourth place every other period', () => {
    const counts = { ...emptyCategoryCounts(), beer: 50, cocktail: 40, softdrink: 30, ramen: 5, kebab: 999 };
    const available = rankedCategories(counts);
    expect(featuredCategories(counts, available, 10)).toEqual(['coffee', 'pizza', 'beer', 'cocktail']);
    expect(featuredCategories(counts, available, 12)).toEqual(['coffee', 'pizza', 'beer', 'cocktail']);
    // Odd periods give the fourth place to the other categories in turn.
    expect([11, 13, 15, 17].map(period => featuredCategories(counts, available, period)[3])).toEqual(['burger', 'softdrink', 'ramen', 'burger']);
    expect(featuredCategories(counts, available, 11).slice(0, 3)).toEqual(['coffee', 'pizza', 'beer']);
    expect(featuredCategories(counts, rankedCategories(counts, new Set(['pizza', 'ramen', 'burger', 'softdrink', 'cocktail'])), 11)).toEqual(['coffee', 'beer']);
    expect(featuredCategories(counts, rankedCategories(counts, new Set(['pizza'])), 10)).toEqual(['coffee', 'beer', 'cocktail', 'softdrink']);
  });
  it('decides the row once per two UTC days from the clicks before that period', () => {
    const start = categoryPeriodStart(categoryPeriod(now));
    expect(categoryPeriod(start)).toBe(categoryPeriod(start + 2 * 86400000 - 1));
    expect(categoryPeriod(start + 2 * 86400000)).toBe(categoryPeriod(start) + 1);
    const day = (time: number) => new Date(time).toISOString().slice(0, 10);
    const state: CategoryState = { days: {
      [day(start - 86400000)]: { ...emptyCategoryCounts(), beer: 3 },
      [day(start)]: { ...emptyCategoryCounts(), cocktail: 50 },
    }, visitorDay: '', visitors: {} };
    expect(rankingCounts(state, start + 86400000)).toEqual({ ...emptyCategoryCounts(), beer: 3 });
  });
  it('counts at most one click per visitor, category and UTC day across clients', async () => {
    const store = memoryStore();
    await recordCategoryClick(store, 'kebab', 'visitor-a', now);
    await recordCategoryClick(store, 'kebab', 'visitor-a', now);
    await recordCategoryClick(store, 'pizza', 'visitor-a', now);
    await recordCategoryClick(store, 'kebab', 'visitor-b', now);
    expect(popularityCounts((await store.read()).state, now)).toEqual({ coffee: 0, beer: 0, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 1, kebab: 2 });
    await recordCategoryClick(store, 'kebab', 'visitor-a', now + 86400000);
    expect(popularityCounts((await store.read()).state, now + 86400000).kebab).toBe(3);
    expect((await store.read()).state.visitors).toEqual({ 'visitor-a': ['kebab'] });
  });
  it('merges concurrent visitors without losing clicks and deduplicates concurrent retries', async () => {
    const store = memoryStore();
    await Promise.all(['a', 'b', 'a'].map(visitor => recordCategoryClick(store, 'kebab', visitor, now)));
    expect(popularityCounts((await store.read()).state, now).kebab).toBe(2);
  });
  it('expires old popularity after 30 calendar days and removes old visitor hashes', async () => {
    const state: CategoryState = { days: {
      '2026-09-19': { ...emptyCategoryCounts(), pizza: 100 },
      '2026-09-20': { ...emptyCategoryCounts(), coffee: 2 },
    }, visitorDay: '2026-10-18', visitors: { old: ['kebab'] } };
    const store = memoryStore(state);
    expect(popularityCounts(state, now)).toEqual({ coffee: 2, beer: 0, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 0, kebab: 0 });
    await recordCategoryClick(store, 'kebab', 'new', now);
    const saved = (await store.read()).state;
    expect(saved.days).not.toHaveProperty('2026-09-19');
    expect(saved.visitors).toEqual({ new: ['kebab'] });
  });
  it('ignores malformed counts instead of breaking the menu', () => {
    expect(categoryCounts({ beer: -5, pizza: '900', kebab: Infinity, ramen: 3, falafel: 9 })).toEqual({ ...emptyCategoryCounts(), ramen: 3 });
  });
});
