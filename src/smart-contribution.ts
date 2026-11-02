import type { City } from './cities';
import type { PriceInput } from './community';
import { coffeeLabels, type Bar } from './data';
import { beerGroupLabels } from './beer-selection';
import { cocktailSelectionLabels, softdrinkSelectionLabels } from './gastro-selection';
import { normalizeSearch, searchSuggestions } from './search';
import { normalizeSmart, parseSmartQuery } from './smart-search';

export type ContributionDraft = {
  text: string;
  venueQuery: string;
  fields: Partial<PriceInput>;
  notes: ('price' | 'product' | 'pizza' | 'portion' | 'special' | 'multiple')[];
};

// A search budget is not an observed price. Only a single, explicit amount can
// prefill a contribution; ranges, offers and several prices need manual input.
export function parseContribution(text: string, city: City, venue?: Bar): ContributionDraft {
  let content = text;
  if (venue) {
    const escaped = venue.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu'), ' ');
  }
  content = content.replace(/\b(?:margeritha|margerita|margheritha)\b/gi, 'margherita');
  const query = parseSmartQuery(content, city);
  const normalized = normalizeSmart(content);
  const fields: Partial<PriceInput> = {};
  const notes: ContributionDraft['notes'] = [];
  const amount = '(\\d{1,3}(?:[.,]\\d{1,2})?)(?!\\d|[.,]\\d)';
  const currency = '(?:chf|sfr|fr\\.?|franken|stutz)';
  const prices = [...content.matchAll(new RegExp(`(?<![\\d.,])(?:${currency}\\s*${amount}|${amount}\\s*(?:\\.\\s*[-–]|${currency})|(?:für|fuer|for)\\s+${amount}(?!\\s*(?:dl|cl|ml|l)\\b))`, 'giu'))];
  const uncertainPrice = /\b(ab|unter|bis|max|maximal|ca|circa|etwa|ungefahr|from|under|up to|about|statt|instead|zwischen|between)\b/.test(normalized)
    || /\d\s*[-–/]\s*\d|[-−]\s*\d/.test(content);
  const special = /\b(aktion|aktionspreis|happy hour|nur heute|only today|take\s?away|lieferung|delivery|menu|menupreis|combo|student|studierende)\b/.test(normalized);
  const price = prices.length === 1 ? Number((prices[0][1] || prices[0][2] || prices[0][3]).replace(',', '.')) : NaN;
  if (!uncertainPrice && !special && price >= 0.5 && price <= 50) fields.priceChf = price;
  else notes.push('price');
  if (special) notes.push('special');

  fields.drink = query.drink;
  if (query.drink === 'coffee') {
    fields.coffeeType = query.coffeeType;
    if (query.coffeeType) fields.name = coffeeLabels[query.coffeeType];
    else notes.push('product');
  } else if (query.drink === 'pizza') {
    const partial = /\b(stuck|slice|slices|mini(?:pizza)?|kinder(?:pizza)?|kids|half|halbe|halben)\b/.test(normalized);
    if (!query.margherita || query.pizzaGroup || query.glutenFree || query.diet || partial) {
      delete fields.drink; delete fields.priceChf;
      notes.push('pizza');
    } else {
      fields.name = 'Pizza Margherita'; fields.pizzaType = 'margherita';
    }
  } else if (query.drink === 'beer') {
    fields.name = query.beerSelection && query.beerSelection in beerGroupLabels
      ? beerGroupLabels[query.beerSelection as keyof typeof beerGroupLabels] : query.stange ? 'Stange' : 'Bier';
    fields.beerType = query.beerType || 'unknown';
    fields.alcoholFree = Boolean(query.alcoholFree);
    if (query.stange && !['bottle', 'can'].includes(fields.beerType)) fields.serving = 'stange';
    fields.volumeMl = query.volumeMl ?? (fields.serving ? null : undefined);
    if (fields.volumeMl === undefined) notes.push('portion');
  } else if (query.drink === 'softdrink') {
    if (query.softdrinkSelection) fields.name = softdrinkSelectionLabels[query.softdrinkSelection];
    fields.volumeMl = query.volumeMl;
    if (!query.volumeMl) notes.push('portion');
  } else if (query.drink === 'cocktail') {
    if (query.cocktailSelection) fields.name = cocktailSelectionLabels[query.cocktailSelection];
  } else if (query.drink === 'burger') {
    fields.name = content.match(/\b(?:(?:veggie|vegi|vegan|smash)\s+)?(?:cheeseburger|hamburger|burger)\b/iu)?.[0];
  } else if (query.drink === 'ramen') {
    fields.name = content.match(/\b(?:(?:shoyu|tonkotsu|miso|shio|vegan)\s+)?ramen\b/iu)?.[0];
  } else if (query.drink === 'kebab') {
    fields.foodType = query.streetfoodFood === 'falafel' ? 'falafel' : query.streetfoodFood === 'doner' ? 'doner' : undefined;
    fields.portionType = query.plate ? 'plate' : /\b(durum|wrap)\b/.test(normalized) ? 'wrap' : /\b(brot|bread)\b/.test(normalized) ? 'bread' : undefined;
    if (fields.foodType && fields.portionType) fields.name = `${fields.portionType === 'plate' ? 'Teller' : fields.portionType === 'bread' ? 'Im Brot' : 'Dürüm'} ${fields.foodType === 'falafel' ? 'Falafel' : 'Kebab'}`;
    else notes.push('portion');
  }
  const products = content.split(/\s+(?:und|oder|and|or)\s+|[;+]|,(?!\d)/iu).filter(part => parseSmartQuery(part, city).drink);
  const severalPortions = /\b(?:[2-9]|\d{2,}|zwei|drei|vier|funf|two|three|four|five)\s+(?:ganze?\s+)?(?:pizz[ae]n?|margheritas?|cappuccin[oi]s?|espress[oi]s?|kaffees?|coffees?|bier[e]?|beers?|stangen?|burgers?|cocktails?)\b/.test(normalized);
  if (products.length > 1 || severalPortions) {
    delete fields.priceChf;
    if (products.length > 1) for (const key of Object.keys(fields)) delete fields[key as keyof PriceInput];
    notes.push('multiple');
  }
  // Unrecognised product names are deliberately left for the editable form.
  if (!fields.name && !notes.includes('pizza') && !notes.includes('product')) notes.push('product');
  const venueQuery = query.rest.filter(word => !/^\d/.test(word) && !/^(kostet|kosten|gibts|preis|price|costs|stuck|slice|heute|gestern|today|yesterday)$/i.test(word)).join(' ');
  return { text, venueQuery, fields, notes };
}

// Always offer explicit choices. Partial name matches help with extra location
// hints ("Food Court am hbn") but never pick or create a venue automatically.
export function contributionVenues(venues: Bar[], text: string, venueQuery: string): Bar[] {
  const sentence = ` ${normalizeSearch(text)} `;
  const words = normalizeSearch(venueQuery).split(' ').filter(word => word.length > 1);
  const direct = searchSuggestions(venues, venueQuery, 6);
  const candidates = venues.map(bar => {
    const name = normalizeSearch(bar.name);
    const nameWords = name.split(' ');
    const overlap = words.filter(word => nameWords.includes(word)).length;
    const full = name.length >= 3 && sentence.includes(` ${name} `);
    return { bar, score: full ? 100 + name.length : direct.some(item => item.id === bar.id) ? 80 : overlap >= Math.min(2, nameWords.length) ? overlap : 0 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.bar.name.localeCompare(b.bar.name, 'de'));
  return candidates.slice(0, 6).map(item => item.bar);
}
