// Labels are German and go through t() where they are shown.
// A Dürüm and a Kebab in bread are the same snack; a plate is a meal and is compared on its own.
const portions = { doner: { snack: 'Kebab / Dürüm', plate: 'Teller', all: 'Alle' }, falafel: { snack: 'Sandwich / Wrap', plate: 'Teller', all: 'Alle' } } as const;
export type StreetfoodPortion = keyof typeof portions.doner;
export const streetfoodPortionLabels = (food: 'doner' | 'falafel'): Record<StreetfoodPortion, string> => portions[food];

export function parseStreetfoodPortion(value: string | null): StreetfoodPortion | undefined {
  return value && Object.hasOwn(portions.doner, value) ? value as StreetfoodPortion : undefined;
}

export function matchesStreetfoodPortion(portionType: string | undefined, selection: StreetfoodPortion = 'snack'): boolean {
  if (selection === 'all') return portionType === 'wrap' || portionType === 'bread' || portionType === 'plate';
  return selection === 'plate' ? portionType === 'plate' : portionType === 'wrap' || portionType === 'bread';
}
