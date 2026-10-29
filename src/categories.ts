import { isCurrentOffer, type Offer } from './data.js';

export const categories = ['coffee', 'beer', 'ramen', 'burger', 'softdrink', 'cocktail', 'pizza', 'doner', 'falafel'] as const;
export type Category = typeof categories[number];
export type CategoryCounts = Record<Category, number>;
export const emptyCategoryCounts = (): CategoryCounts => ({ coffee: 0, beer: 0, ramen: 0, burger: 0, softdrink: 0, cocktail: 0, pizza: 0, doner: 0, falafel: 0 });
export const isCategory = (value: unknown): value is Category => categories.includes(value as Category);

export function streetfoodPriceCount(dataset: unknown, category: 'doner' | 'falafel'): number {
  if (!dataset || typeof dataset !== 'object' || !('bars' in dataset) || !Array.isArray(dataset.bars)) return 0;
  return dataset.bars.reduce((count, bar) => count + (bar?.type === 'fast_food' && Array.isArray(bar.offers) ? bar.offers.filter((offer: Offer & { foodType?: string; portionType?: string }) =>
    offer?.foodType === category && offer.portionType === 'wrap' && Number.isFinite(offer.priceChf) && offer.priceChf > 0 && isCurrentOffer(offer)
  ).length : 0), 0);
}

export function categoryCounts(value: unknown): CategoryCounts {
  const counts = emptyCategoryCounts();
  if (value && typeof value === 'object') {
    for (const category of categories) {
      const count = (value as Record<string, unknown>)[category];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) counts[category] = count;
    }
  }
  return counts;
}

// The category row is decided per period of two UTC days, so it does not shift while people use it.
const dayMs = 86400000;
export const categoryPeriod = (now = Date.now()) => Math.floor(now / dayMs / 2);
export const categoryPeriodStart = (period: number) => period * 2 * dayMs;

// Coffee and pizza always lead the row; the two most clicked other categories follow.
// Every other period the fourth place goes to another category in turn, so it can collect clicks too.
export function featuredCategories(counts: CategoryCounts, available: readonly Category[], period: number, size = 4): Category[] {
  const fixed = (['coffee', 'pizza'] as const).filter(category => available.includes(category));
  const pool = available.filter(category => !fixed.includes(category as 'coffee' | 'pizza') && category !== 'doner' && category !== 'falafel')
    .sort((a, b) => counts[b] - counts[a] || categories.indexOf(a) - categories.indexOf(b));
  const slots = Math.max(0, size - fixed.length);
  const chosen = pool.slice(0, slots);
  const challengers = pool.slice(slots);
  if (period % 2 === 1 && chosen.length && challengers.length) chosen[chosen.length - 1] = challengers[Math.floor(period / 2) % challengers.length];
  return [...fixed, ...chosen];
}

export function rankedCategories(counts: CategoryCounts, hidden: ReadonlySet<Category> = new Set()): Category[] {
  // Coffee is always first; popularity only orders the remaining categories.
  return categories.filter(category => !hidden.has(category))
    .sort((a, b) => a === 'coffee' ? -1 : b === 'coffee' ? 1 : counts[b] - counts[a]);
}
