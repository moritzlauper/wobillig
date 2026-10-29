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

export const softdrinkSelectionLabels = {
  all: 'Alle Softdrinks',
  cola: 'Coca-Cola / Zero',
  rivella: 'Rivella',
  fanta: 'Fanta',
  sprite: 'Sprite',
  icetea: 'Eistee',
  tonic: 'Tonic Water',
  bitter_lemon: 'Bitter Lemon',
  ginger_beer: 'Ginger Beer',
  ginger_ale: 'Ginger Ale',
  schorle: 'Schorle',
  lemonade: 'Limonade',
} as const;
export type SoftdrinkSelection = keyof typeof softdrinkSelectionLabels;
export type SoftdrinkGroup = Exclude<SoftdrinkSelection, 'all'>;

// Menus often list several drinks at one price ("Coca Cola / Zero", "Rivella rot oder blau"),
// so a soft drink can belong to more than one group.
const softdrinkPatterns: Record<SoftdrinkGroup, RegExp> = {
  cola: /\b(?:cola|coke)\b/,
  rivella: /\brivella\b/,
  fanta: /\bfanta\b/,
  sprite: /\bsprite\b/,
  icetea: /eistee|ice[\s-]*tea|fuse[\s-]*tea/,
  tonic: /\btonic\b/,
  bitter_lemon: /\bbitter\s*lemon\b/,
  ginger_beer: /\bginger\s*beer\b/,
  ginger_ale: /\bginger\s*ale\b/,
  schorle: /schorle/,
  lemonade: /limonade|lemonade/,
};
export function softdrinkGroups(name: string): SoftdrinkGroup[] {
  const text = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return (Object.keys(softdrinkPatterns) as SoftdrinkGroup[]).filter(group => softdrinkPatterns[group].test(text));
}
export function parseSoftdrinkSelection(value: string | null): SoftdrinkSelection | undefined {
  return value && Object.hasOwn(softdrinkSelectionLabels, value) ? value as SoftdrinkSelection : undefined;
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
  mocktail: 'Mocktails',
} as const;
export type CocktailSelection = keyof typeof cocktailSelectionLabels;
export type CocktailGroup = Exclude<CocktailSelection, 'all'>;

const cocktailPatterns: Record<Exclude<CocktailGroup, 'mocktail'>, RegExp> = {
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
// A virgin Aperol Spritz or a Negroni 0.0% is a mocktail, not the classic it is named after.
const mocktailPattern = /\bvirgin\b|alkoholfrei|alcohol[\s-]*free|ohne alkohol|mocktail|zero[\s-]*proof|(?<!cola\s)\bzero\b|(?<![\d.,])0(?:[.,]0)?\s*%|crodino|san\s*bitter/;
export function cocktailGroup(name: string): CocktailGroup | undefined {
  const text = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  if (mocktailPattern.test(text)) return 'mocktail';
  return (Object.keys(cocktailPatterns) as Exclude<CocktailGroup, 'mocktail'>[]).find(group => cocktailPatterns[group].test(text));
}
export function parseCocktailSelection(value: string | null): CocktailSelection | undefined {
  return value && Object.hasOwn(cocktailSelectionLabels, value) ? value as CocktailSelection : undefined;
}
