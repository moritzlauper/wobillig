export const categories = ['coffee', 'beer', 'pizza', 'doner', 'falafel'] as const;
export type Category = typeof categories[number];
export type CategoryCounts = Record<Category, number>;
export const emptyCategoryCounts = (): CategoryCounts => ({ coffee: 0, beer: 0, pizza: 0, doner: 0, falafel: 0 });
export const isCategory = (value: unknown): value is Category => categories.includes(value as Category);

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
