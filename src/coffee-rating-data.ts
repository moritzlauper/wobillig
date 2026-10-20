export type CoffeeRating = { average: number | null; count: number };
export type CoffeeRatings = Record<string, CoffeeRating>;

export function isCoffeeRating(value: unknown): value is CoffeeRating {
  if (!value || typeof value !== 'object') return false;
  const rating = value as CoffeeRating;
  return Number.isInteger(rating.count) && rating.count > 0 &&
    (rating.count < 3 ? rating.average === null :
      typeof rating.average === 'number' && Number.isFinite(rating.average) && rating.average >= 1 && rating.average <= 5);
}
