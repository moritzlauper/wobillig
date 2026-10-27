// Labels are German and go through t() where they are shown.
export const burgerSelectionLabels = {
  all: 'Alle Burger',
  vegetarian: 'Vegi Burger',
  vegan: 'Vegan',
  glutenfree: 'Glutenfrei',
} as const;
export type BurgerSelection = keyof typeof burgerSelectionLabels;

export function parseBurgerSelection(value: string | null): BurgerSelection | undefined {
  return value && Object.hasOwn(burgerSelectionLabels, value) ? value as BurgerSelection : undefined;
}
