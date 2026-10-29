import { describe, expect, it } from 'vitest';
import { categoryCounts, categoryPeriod, categoryPeriodStart, emptyCategoryCounts, featuredCategories, rankedCategories, streetfoodPriceCount } from '../src/categories';
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
    expect(rankedCategories(emptyCategoryCounts())).toEqual(['coffee', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail', 'pizza', 'doner', 'falafel']);
    const counts = { coffee: 40, beer: 30, ramen: 0, burger: 0, softdrink: 2, cocktail: 0, pizza: 1, doner: 20, falafel: 0 };
    expect(rankedCategories(counts)).toEqual(['coffee', 'beer', 'doner', 'softdrink', 'pizza', 'ramen', 'burger', 'cocktail', 'falafel']);
    expect(rankedCategories(counts, new Set(['pizza']))).toEqual(['coffee', 'beer', 'doner', 'softdrink', 'ramen', 'burger', 'cocktail', 'falafel']);
    expect(rankedCategories(counts, new Set(['ramen', 'softdrink']))).toEqual(['coffee', 'beer', 'doner', 'pizza', 'burger', 'cocktail', 'falafel']);
    expect(rankedCategories(counts, new Set(['burger', 'cocktail']))).toEqual(['coffee', 'beer', 'doner', 'softdrink', 'pizza', 'ramen', 'falafel']);
    const coffeeLeastPopular = { coffee: 0, beer: 100, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 200, doner: 300, falafel: 400 };
    expect(rankedCategories(coffeeLeastPopular)).toEqual(['coffee', 'falafel', 'doner', 'pizza', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail']);
    expect(rankedCategories(coffeeLeastPopular, new Set(['pizza']))).toEqual(['coffee', 'falafel', 'doner', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail']);
  });
  it('keeps coffee and pizza first and features the two most clicked others, rotating the fourth place every other period', () => {
    const counts = { ...emptyCategoryCounts(), beer: 50, cocktail: 40, softdrink: 30, ramen: 5, doner: 999 };
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
    await recordCategoryClick(store, 'doner', 'visitor-a', now);
    await recordCategoryClick(store, 'doner', 'visitor-a', now);
    await recordCategoryClick(store, 'falafel', 'visitor-a', now);
    await recordCategoryClick(store, 'doner', 'visitor-b', now);
    expect(popularityCounts((await store.read()).state, now)).toEqual({ coffee: 0, beer: 0, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 0, doner: 2, falafel: 1 });
    await recordCategoryClick(store, 'doner', 'visitor-a', now + 86400000);
    expect(popularityCounts((await store.read()).state, now + 86400000).doner).toBe(3);
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
    expect(popularityCounts(state, now)).toEqual({ coffee: 2, beer: 0, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 0, doner: 0, falafel: 0 });
    await recordCategoryClick(store, 'falafel', 'new', now);
    const saved = (await store.read()).state;
    expect(saved.days).not.toHaveProperty('2026-09-19');
    expect(saved.visitors).toEqual({ new: ['falafel'] });
  });
  it('ignores malformed counts instead of breaking the menu', () => {
    expect(categoryCounts({ beer: -5, pizza: '900', doner: Infinity, falafel: 3 })).toEqual({ ...emptyCategoryCounts(), falafel: 3 });
  });
});
