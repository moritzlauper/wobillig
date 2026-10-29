// Soft drinks and cocktails come from the gastro scan (scraper/gastro.py).
// Labels are German and go through t() where they are shown.
// Listed in menu order: object keys that look like numbers would sort first.
export const softdrinkSizes = ['300-330', '200', '500', 'all'] as const;
export type SoftdrinkSize = typeof softdrinkSizes[number];
export const softdrinkSizeLabels: Record<SoftdrinkSize, string> = { '300-330': '3 / 3.3 dl', '200': '2 dl', '500': '5 dl', all: 'Alle Grössen' };

export function parseSoftdrinkSize(value: string | null): SoftdrinkSize | undefined {
  return value && Object.hasOwn(softdrinkSizeLabels, value) ? value as SoftdrinkSize : undefined;
}
export function matchesSoftdrinkSize(volumeMl: number | null, size: SoftdrinkSize = '300-330'): boolean {
  if (size === 'all') return true;
  if (size === '300-330') return volumeMl === 300 || volumeMl === 330;
  return volumeMl === Number(size);
}

export const cocktailSelectionLabels = {
  all: 'Alle Cocktails',
  aperol_spritz: 'Aperol Spritz',
  hugo: 'Hugo',
  gin_tonic: 'Gin Tonic',
  negroni: 'Negroni',
  mojito: 'Mojito',
  moscow_mule: 'Moscow Mule',
  espresso_martini: 'Espresso Martini',
  margarita: 'Margarita',
  caipirinha: 'Caipirinha',
} as const;
export type CocktailSelection = keyof typeof cocktailSelectionLabels;
export type CocktailGroup = Exclude<CocktailSelection, 'all'>;

const cocktailPatterns: Record<CocktailGroup, RegExp> = {
  aperol_spritz: /\baperol\b/,
  hugo: /\bhugo\b/,
  gin_tonic: /\bgin\s*(?:&|\+|and|und|n)?\s*tonic\b/,
  negroni: /\bnegroni\b/,
  mojito: /\bmojito\b/,
  moscow_mule: /\bmoscow\s*mule\b/,
  espresso_martini: /\bespresso\s*martini\b/,
  margarita: /\bmargarita\b/,
  caipirinha: /\bcaipirinha\b/,
};
export function cocktailGroup(name: string): CocktailGroup | undefined {
  const text = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return (Object.keys(cocktailPatterns) as CocktailGroup[]).find(group => cocktailPatterns[group].test(text));
}
export function parseCocktailSelection(value: string | null): CocktailSelection | undefined {
  return value && Object.hasOwn(cocktailSelectionLabels, value) ? value as CocktailSelection : undefined;
}
