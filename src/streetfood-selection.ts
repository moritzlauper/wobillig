// Labels are German and go through t() where they are shown.
// A Dürüm and a döner in bread are the same snack; a plate is a meal and is compared on its own.
export const streetfoodPortionLabels = {
  snack: 'Dürüm & im Brot',
  plate: 'Teller',
  all: 'Alle Portionen',
} as const;
export type StreetfoodPortion = keyof typeof streetfoodPortionLabels;

export function parseStreetfoodPortion(value: string | null): StreetfoodPortion | undefined {
  return value && Object.hasOwn(streetfoodPortionLabels, value) ? value as StreetfoodPortion : undefined;
}

export function matchesStreetfoodPortion(portionType: string | undefined, selection: StreetfoodPortion = 'snack'): boolean {
  if (selection === 'all') return portionType === 'wrap' || portionType === 'bread' || portionType === 'plate';
  return selection === 'plate' ? portionType === 'plate' : portionType === 'wrap' || portionType === 'bread';
}
