import { isCurrentOffer, type Offer } from './data.js';

export const categories = ['coffee', 'beer', 'pizza', 'doner', 'falafel'] as const;
export type Category = typeof categories[number];
export type CategoryCounts = Record<Category, number>;
export const emptyCategoryCounts = (): CategoryCounts => ({ coffee: 0, beer: 0, pizza: 0, doner: 0, falafel: 0 });
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

export function rankedCategories(counts: CategoryCounts, pizzaAvailable = true): Category[] {
  // Coffee is always first; popularity only orders the remaining categories.
  return categories.filter(category => category !== 'pizza' || pizzaAvailable)
    .sort((a, b) => a === 'coffee' ? -1 : b === 'coffee' ? 1 : counts[b] - counts[a]);
}
