// Groups curated from the recorded menu names. Match explicit product/brand
// names only: a generic Lager, Stange or house beer cannot establish a brand.
export const beerGroupLabels = {
  quollfrisch: 'Quöllfrisch',
  feldschlosschen: 'Feldschlösschen',
  schneider: 'Schneider Weisse',
  erdinger: 'Erdinger',
  corona: 'Corona',
  heineken: 'Heineken',
  san_miguel: 'San Miguel',
  hurlimann: 'Hürlimann',
  amboss: 'Amboss',
  guinness: 'Guinness',
  super_bock: 'Super Bock',
  lagunitas: 'Lagunitas',
  moretti: 'Birra Moretti',
  valaisanne: 'Valaisanne',
  singha: 'Singha',
  grimbergen: 'Grimbergen',
  ittinger: 'Ittinger',
  turbinenbrau: 'Turbinenbräu',
  tegernseer: 'Tegernseer',
  lola: 'Lola',
  asahi: 'Asahi',
  estrella_galicia: 'Estrella Galicia',
  chopfab: 'Chopfab',
  ichnusa: 'Ichnusa',
  peroni: 'Peroni',
  pilsner_urquell: 'Pilsner Urquell',
  carlsberg: 'Carlsberg',
  eichhof: 'Eichhof',
  schutzengarten: 'Schützengarten',
  leermond: 'Appenzeller Leermond',
  barner_muntschi: 'Bärner Müntschi',
  felsenau: 'Felsenau',
  gurten: 'Gurten',
  burgdorfer: 'Burgdorfer',
  rugenbrau: 'Rugenbräu',
  warteck: 'Warteck',
  kitchen_brew: 'Kitchen Brew',
  unser_bier: 'Unser Bier',
  ueli: 'Ueli Bier',
  leffe: 'Leffe',
  desperados: 'Desperados',
  budvar: 'Budvar',
  calanda: 'Calanda',
  efes: 'Efes',
  paulaner: 'Paulaner',
  augustiner: 'Augustiner',
  rothaus: 'Rothaus',
} as const;

export type BeerSelection = keyof typeof beerGroupLabels;

export function normalizeBeerName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/\bguiness\b/g, 'guinness').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const aliases: Partial<Record<BeerSelection, RegExp>> = {
  quollfrisch: /\bq(?:u)?ollfrisch\b/,
  feldschlosschen: /\bfeldschlos{1,2}(?:chen|sen)\b/,
  schneider: /\bschneider (?:weisse|weissbier|weizen)\b/,
  super_bock: /\bsuper ?bock\b/,
  moretti: /\bmoretti\b/,
  ittinger: /\bittinger\b/,
  leermond: /\bleermond\b/,
  barner_muntschi: /\b(?:barner|berner) ?muntschi\b/,
  ueli: /\bueli(?:bier)?\b|\buli(?:bier)?\b/,
  rothaus: /\brothaus\b|\btannen?zapfle\b|\bweizenzapfle\b/,
};
const patterns = (Object.keys(beerGroupLabels) as BeerSelection[]).map(group =>
  [group, aliases[group] || new RegExp(`\\b${normalizeBeerName(beerGroupLabels[group])}\\b`)] as const);

export function beerGroup(name: string): BeerSelection | undefined {
  const text = normalizeBeerName(name);
  const groups = patterns.filter(([, pattern]) => pattern.test(text)).map(([group]) => group);
  // The named beer takes precedence over the brewery when both are on the menu.
  if (groups.includes('barner_muntschi') && groups.every(group => group === 'barner_muntschi' || group === 'felsenau')) return 'barner_muntschi';
  // Do not turn menu alternatives ("Heineken / Corona") into confirmed brands.
  return groups.length === 1 ? groups[0] : undefined;
}

export function parseBeerSelection(value: string | null): BeerSelection | undefined {
  return value && Object.hasOwn(beerGroupLabels, value) ? value as BeerSelection : undefined;
}
