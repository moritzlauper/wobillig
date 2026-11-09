// Fixed rules for the apartment smart search: they read a sentence at once in the browser,
// before Claude's reading arrives (src/apartment-smart.ts).
import { apartmentKinds, emptyApartmentFilter, type ApartmentFeature, type ApartmentKind } from './apartment-data';
import { APARTMENT_SMART_MAX, type ApartmentQuery } from './apartment-smart';
import { districtAliases, normalizeSmart } from './smart-search';

const featureWords: [ApartmentFeature, RegExp][] = [
  ['balkon', /\b(balkon|balkonen|terrasse|loggia|sitzplatz|dachterrasse)\b/],
  ['waschmaschine', /\b(eigene waschmaschine|waschmaschine|waschturm|wm tumbler)\b/],
  ['geschirrspueler', /\b(geschirrspuler|geschirrspueler|abwaschmaschine|spulmaschine)\b/],
  ['lift', /\b(lift|aufzug|fahrstuhl)\b/],
  ['haustiere', /\b(haustiere|haustier|katze|katzen|hund|hunde|tiere erlaubt)\b/],
  ['hindernisfrei', /\b(hindernisfrei|barrierefrei|rollstuhlgangig|rollstuhl)\b/],
];
const kindWords: [ApartmentKind, RegExp][] = [
  ['wg', /\b(wg|wg zimmer|wohngemeinschaft|zimmer in wg|mitbewohner)\b/],
  ['studio', /\b(studio|einzimmerwohnung)\b/],
  ['moebliert', /\b(moebliert|mobliert|furnished)\b/],
  ['haus', /\b(haus|einfamilienhaus|reihenhaus)\b/],
];
const numberWords: Record<string, number> = { ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7 };
const stop = new Set(['ich', 'suche', 'suchen', 'eine', 'einen', 'ein', 'mit', 'und', 'oder', 'oderso', 'so', 'in', 'im', 'am', 'an', 'der', 'die', 'das', 'den', 'dem',
  'fur', 'ab', 'bis', 'unter', 'max', 'maximal', 'hochstens', 'mindestens', 'min', 'chf', 'fr', 'franken', 'stutz', 'pro', 'monat', 'mtl', 'monatlich', 'brutto', 'inkl',
  'wohnung', 'wohnungen', 'mietwohnung', 'zimmer', 'zi', 'zimmerwohnung', 'raum', 'kreis', 'kreise', 'zurich', 'zuri', 'stadt', 'gerne', 'bitte', 'etwa', 'ca', 'circa',
  'mehr', 'als', 'nahe', 'bei', 'beim', 'zum', 'zur', 'von', 'vom', 'auf', 'qm', 'm2', 'm', 'quadratmeter', 'flache', 'gross', 'grosse', 'neue', 'neu', 'miete', 'mieten']);

/** Reads a sentence with fixed rules. Words no rule takes stay in `rest`. */
export function parseApartmentRules(text: string): ApartmentQuery & { rest: string[] } {
  let s = ` ${normalizeSmart(text.slice(0, APARTMENT_SMART_MAX).replace(/\s*½/g, '.5')).replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n: string) => String(Math.round(Number(n) * 1000)))} `;
  const base = emptyApartmentFilter();
  const query: ApartmentQuery & { rest: string[] } = {
    mieteMax: null, zimmerMin: null, zimmerMax: null, flaecheMin: null, arten: [...apartmentKinds], kreise: [], merkmale: [],
    dauer: base.dauer, nurNeu: false, guenstig: base.guenstig, text: '', begriffe: [], rest: [],
  };
  const take = (pattern: RegExp, handle: (...groups: string[]) => void) => {
    s = s.replace(pattern, (...match) => { handle(...match.slice(1).filter(value => typeof value === 'string')); return ' '; });
  };
  const num = (value: string) => numberWords[value] ?? Number(value);
  const rooms = '(\\d+(?:\\.5)?|ein|eine|zwei|drei|vier|funf|sechs|sieben)';
  // Area first, so «60 m2» is not read as a rent.
  take(/\b(?:ab|mindestens|min|uber|mehr als)?\s*(\d{2,3})\s*(?:m2|m 2|qm|quadratmeter|m)\b/g, area => { query.flaecheMin = Number(area); });
  take(new RegExp(`\\b${rooms}\\s*(?:bis|-)\\s*${rooms}\\s*(?:zimmer|zi|raum)\\w*`, 'g'), (a, b) => { query.zimmerMin = num(a); query.zimmerMax = num(b) + (Number.isInteger(num(b)) ? .5 : 0); });
  take(new RegExp(`\\b(?:ab|mindestens|min)\\s*${rooms}\\s*(?:zimmer|zi|raum)\\w*`, 'g'), a => { query.zimmerMin = num(a); });
  take(new RegExp(`\\b(?:bis|maximal|max|hochstens)\\s*${rooms}\\s*(?:zimmer|zi|raum)\\w*`, 'g'), a => { query.zimmerMax = num(a) + (Number.isInteger(num(a)) ? .5 : 0); });
  // «3 Zimmer» means 3 or 3½, «3.5 Zimmer» exactly 3½.
  take(new RegExp(`\\b${rooms}\\s*(?:zimmer|zi|raum)\\w*`, 'g'), a => { const n = num(a); query.zimmerMin = n; query.zimmerMax = Number.isInteger(n) ? n + .5 : n; });
  take(/\b(?:bis|unter|max|maximal|hochstens|fur|budget)\s*(?:chf|fr)?\s*(\d{3,5})\b(?:\s*(?:franken|chf|fr)\b)?/g, rent => { query.mieteMax = Number(rent); });
  take(/\b(\d{3,5})\s*(?:franken|stutz|chf|fr)\b/g, rent => { query.mieteMax = Number(rent); });
  take(/\b(?:kreis|kreise|k)\s*((?:\d{1,2}(?:\s*(?:und|oder|,)?\s*)?)+)/g, list => {
    for (const n of list.match(/\d{1,2}/g) || []) if (Number(n) >= 1 && Number(n) <= 12) query.kreise.push(Number(n));
  });
  for (const [n, names] of Object.entries(districtAliases.zurich || {})) {
    for (const name of names) take(new RegExp(`\\b${normalizeSmart(name)}\\b`, 'g'), () => { query.kreise.push(Number(n)); });
  }
  // Postcodes and street names are looked up literally.
  take(/\b(80\d\d)\b/g, plz => { query.text = `${query.text} ${plz}`.trim(); });
  take(/\b(\p{L}+(?:strasse|str|weg|gasse|platz|quai|rain|halde))\b/gu, street => { query.text = `${query.text} ${street.replace(/str$/, 'strasse')}`.trim(); });
  take(/\b(unbefristet|unbefristete|langfristig\w*|dauerhaft)\b/g, word => { query.dauer = word.startsWith('lang') ? 'lang' : 'unbefristet'; });
  take(/\b(auch befristet|egal wie lange|befristet oder unbefristet)\b/g, () => { query.dauer = 'alle'; });
  take(/\b(befristet|befristete|zwischenmiete|untermiete|temporar|kurzfristig)\b/g, () => { query.dauer = 'befristet'; });
  take(/\b(heute|neueste|neu reingekommen|frisch)\b/g, () => { query.nurNeu = true; });
  take(/\b(gunstig\w*|billig\w*|preiswert\w*)\b/g, () => { query.guenstig = true; });
  const kinds: ApartmentKind[] = [];
  for (const [kind, pattern] of kindWords) take(new RegExp(pattern.source, 'g'), () => { kinds.push(kind); });
  if (kinds.length) query.arten = [...new Set(kinds)];
  for (const [feature, pattern] of featureWords) take(new RegExp(pattern.source, 'g'), () => { if (!query.merkmale.includes(feature)) query.merkmale.push(feature); });
  query.kreise = [...new Set(query.kreise)].sort((a, b) => a - b);
  if (query.mieteMax != null) query.guenstig = false;
  // Other words stay out of the filter: Claude turns wishes into title words, the rules only report them.
  query.rest = s.split(' ').filter(word => word && !stop.has(word) && !/^\d+$/.test(word));
  return query;
}

