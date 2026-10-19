import { isCurrentOffer, type Offer } from './data.js';

export const categories = ['coffee', 'beer', 'pizza', 'doner', 'falafel'] as const;
export type Category = typeof categories[number];
export type CategoryCounts = Record<Category, number>;
export const emptyCategoryCounts = (): CategoryCounts => ({ coffee: 0, beer: 0, pizza: 0, doner: 0, falafel: 0 });
export const isCategory = (value: unknown): value is Category => categories.includes(value as Category);

export function streetfoodPriceCount(dataset: unknown, category: 'doner' | 'falafel'): number {
  if (!dataset || typeof dataset !== 'object' || !('bars' in dataset) || !Array.isArray(dataset.bars)) return 0;
  return dataset.bars.reduce((count, bar) => count + (Array.isArray(bar?.offers) ? bar.offers.filter((offer: Offer & { foodType?: string }) =>
    offer?.foodType === category && Number.isFinite(offer.priceChf) && offer.priceChf > 0 && isCurrentOffer(offer)
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
  // Stable ties preserve the familiar order; categories without data can still collect interest.
  return categories.filter(category => category !== 'pizza' || pizzaAvailable)
    .sort((a, b) => counts[b] - counts[a]);
}
