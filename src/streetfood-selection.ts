import type { Dataset } from './data.js';

// Labels are German and go through t() where they are shown.
// A Dürüm and a Kebab or falafel in bread are the same snack; a plate is a meal and is compared on its own.
export const streetfoodPortionLabels = {
  snack: 'Dürüm / Im Brot',
  plate: 'Teller',
  all: 'Alle Portionen',
} as const;
export type StreetfoodPortion = keyof typeof streetfoodPortionLabels;

export const streetfoodFoodLabels = {
  all: 'Kebab & Falafel',
  doner: 'Kebab',
  falafel: 'Falafel',
} as const;
export type StreetfoodFood = keyof typeof streetfoodFoodLabels;

export function parseStreetfoodPortion(value: string | null): StreetfoodPortion | undefined {
  return value && Object.hasOwn(streetfoodPortionLabels, value) ? value as StreetfoodPortion : undefined;
}
export function parseStreetfoodFood(value: string | null): StreetfoodFood | undefined {
  return value && Object.hasOwn(streetfoodFoodLabels, value) ? value as StreetfoodFood : undefined;
}

export function matchesStreetfoodPortion(portionType: string | undefined, selection: StreetfoodPortion = 'snack'): boolean {
  if (selection === 'all') return portionType === 'wrap' || portionType === 'bread' || portionType === 'plate';
  return selection === 'plate' ? portionType === 'plate' : portionType === 'wrap' || portionType === 'bread';
}

// The scan publishes döner and falafel separately; the map shows one venue with both.
export function mergeStreetfood(datasets: (Dataset | null | undefined)[]): Dataset | undefined {
  const loaded = datasets.filter((dataset): dataset is Dataset => Array.isArray(dataset?.bars));
  if (!loaded.length) return undefined;
  const bars = new Map<string, Dataset['bars'][number]>();
  for (const bar of loaded.flatMap(dataset => dataset.bars)) {
    const known = bars.get(bar.id);
    bars.set(bar.id, known ? { ...known, offers: [...known.offers, ...bar.offers] } : { ...bar, offers: [...bar.offers] });
  }
  return { ...loaded[0], bars: [...bars.values()] };
}
