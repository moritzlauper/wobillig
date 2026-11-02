import type { City } from './cities';
import type { Category } from './categories';
import type { Filters } from './data';
import { beerGroupLabels, type BeerSelection } from './beer-selection';
import type { PizzaGroup, PizzaSelection } from './pizza-selection';
import type { CocktailSelection, SoftdrinkSelection, SoftdrinkSize } from './gastro-selection';
import type { StreetfoodFood, StreetfoodPortion } from './streetfood-selection';
import type { Locale } from './i18n';

// The smart search reads a sentence such as «Stange unter 5 Franken im Kreis 4, jetzt offen» with fixed rules
// and turns it into the filters the map already has. Nothing is sent anywhere and nothing is guessed:
// words the rules do not know stay over and are tried as a venue name, beer or pizza.

export type SmartQuery = {
  drink?: Category;
  coffeeType?: string;
  volumeMl?: number;
  stange?: boolean;
  beerType?: 'draft' | 'bottle' | 'can';
  beerSelection?: BeerSelection;
  pizzaGroup?: PizzaGroup;
  margherita?: boolean;
  cocktailSelection?: Exclude<CocktailSelection, 'all'>;
  softdrinkSelection?: Exclude<SoftdrinkSelection, 'all'>;
  streetfoodFood?: Exclude<StreetfoodFood, 'all'> | 'all';
  plate?: boolean;
  diet?: 'vegetarian' | 'vegan';
  glutenFree?: boolean;
  alcoholFree?: boolean;
  cafe?: boolean;
  max?: number;
  cheap?: boolean;
  // "now" or a time of day as HH:MM.
  open?: string;
  outdoor?: boolean;
  district?: number;
  type?: string;
  near?: boolean;
  // Words that none of the rules took, in the visitor's spelling.
  rest: string[];
};

// The changes a query makes to the filters. Unnamed place and time filters start over,
// so every sentence describes the whole search; the category stays when none is named.
export type SmartPlan = {
  filters: Partial<Filters>;
  cheap: boolean;
  near: boolean;
  unavailable?: Category;
};

export function normalizeSmart(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss')
    .replace(/(\d)\s*\.\s*[-–]/g, '$1 chf ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[.:](?!\d)|(?<!\d)[.:]|[^\p{L}\p{N}.:<\s]/gu, ' ')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const edge = '(?<![\\p{L}\\p{N}])', end = '(?![\\p{L}\\p{N}])';
function words(list: string[]): RegExp {
  const phrases = [...new Set(list.map(normalizeSmart))].sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`${edge}(?:${phrases.join('|')})${end}`, 'gu');
}
function table<T>(entries: [T, string[]][]): [T, RegExp][] {
  return entries.map(([value, list]) => [value, words(list)]);
}

const number = '(\\d{1,3}(?:\\.\\d{1,2})?)';
const currency = '(?:chf|sfr|fr|franken|frankli|stutz|francs?|bucks)';
const priceAfterKeyword = new RegExp(`${edge}(?:unter|bis|max|maximal|maximum|hochstens|weniger als|nicht mehr als|nicht uber|under|below|up to|less than|at most|moins de|<)\\s*(?:${currency}\\s*)?${number}(?!\\s*(?:dl|cl|ml|l|liter|uhr|h|pm|am)${end})(?![:.]?\\d)(?:\\s*${currency}${end})?`, 'gu');
const priceWithCurrency = new RegExp(`${edge}(?:${currency}\\s*${number}|${number}\\s*${currency})${end}`, 'gu');
const timeOfDay = new RegExp(`${edge}(um|ab|nach|bis|at|after|until|vers|a)\\s+(\\d{1,2})(?:\\s*[:.h]\\s*(\\d{2}))?\\s*(uhr|h|pm|am)?${end}`, 'gu');
const districtNumber = new RegExp(`${edge}(?:kreis|chreis|stadtkreis|district|quartier|stadtteil|arrondissement)\\s*(\\d{1,2})${end}`, 'gu');
const volume = new RegExp(`${edge}(\\d(?:\\.\\d{1,2})?|\\d{2})\\s*(dl|cl|l|liter)${end}`, 'gu');

const openNow = words(['jetzt offen', 'jetzt geöffnet', 'noch offen', 'gerade offen', 'hat offen', 'jetzt auf', 'offen', 'geöffnet', 'jetzt', 'open now', 'currently open', 'open', 'now', 'ouvert maintenant', 'ouvert', 'maintenant']);
const times = table<string>([
  ['23:00', ['spät', 'spät noch', 'nachts', 'in der nacht', 'late', 'late night', 'tard']],
  ['20:00', ['heute abend', 'am abend', 'abends', 'tonight', 'this evening', 'ce soir']],
  ['12:15', ['zmittag', 'mittag', 'mittags', 'über mittag', 'am mittag', 'lunch', 'midi']],
  ['08:30', ['zmorge', 'frühstück', 'breakfast', 'petit déjeuner']],
]);
const outdoor = words(['terrasse', 'terrassen', 'terasse', 'terrace', 'draussen', 'drausen', 'dusse', 'outdoor', 'outdoors', 'outside', 'aussen', 'aussenbereich', 'im freien', 'garten', 'gartenwirtschaft', 'gartenbeiz', 'biergarten', 'garden', 'beer garden', 'boulevard', 'an der sonne', 'sonnig', 'sunny', 'en terrasse']);
const near = words(['in der nähe', 'in meiner nähe', 'nähe', 'nahe', 'in der umgebung', 'um die ecke', 'hier', 'nearby', 'near me', 'near', 'close by', 'close to me', 'around me', 'près de moi', 'à proximité', 'proche', 'ici']);
const cheap = words(['am günstigsten', 'günstig', 'günstige', 'günstiger', 'günstiges', 'günstigste', 'günstigsten', 'günstigster', 'günstigstes', 'billig', 'billige', 'billiges', 'billigste', 'billigsten', 'billigster', 'preiswert', 'cheap', 'cheaper', 'cheapest', 'budget', 'low budget', 'pas cher', 'bon marché', 'wobillig']);
const diets = table<'vegan' | 'vegetarian'>([
  ['vegan', ['vegan', 'vegane', 'veganer', 'veganes', 'veganen']],
  ['vegetarian', ['vegi', 'vegie', 'veggie', 'vegetarisch', 'vegetarische', 'vegetarischer', 'vegetarisches', 'vegetarian', 'végétarien', 'végé']],
]);
const glutenFree = words(['glutenfrei', 'glutenfreie', 'glutenfreies', 'glutenfreier', 'gluten frei', 'gluten free', 'glutenfree', 'ohne gluten', 'sans gluten']);
const alcoholFree = words(['alkoholfrei', 'alkoholfreie', 'alkoholfreies', 'alkoholfreier', 'alkfrei', 'ohne alkohol', 'alcohol free', 'non alcoholic', 'nonalcoholic', 'sans alcool']);
const cafe = words(['café', 'cafés', 'kaffeehaus', 'coffee shop', 'coffeeshop', 'cafeteria']);
const venueTypes = table<string>([
  ['bar', ['bar', 'bars', 'pub', 'pubs', 'kneipe', 'kneipen']],
  ['restaurant', ['restaurant', 'restaurants', 'resti', 'beiz', 'beizli', 'trattoria', 'osteria', 'ristorante']],
  ['fast_food', ['imbiss', 'take away', 'takeaway', 'take out', 'snack bar', 'fast food', 'street food', 'food truck']],
  ['kiosk', ['kiosk', 'kiosks']],
]);
// Beer words for a size name the category too; "gross" alone only names the size.
const beerSizes = table<[number, boolean]>([
  [[500, true], ['halbe', 'halber liter', 'grosses bier', 'pint', 'pints', 'chübel', 'kübel']],
  [[300, true], ['kleines bier']],
  [[500, false], ['grosses', 'grosse', 'grosser']],
  [[300, false], ['kleines', 'kleine']],
]);

// Each category with its products, most specific phrases first. The first category in the sentence wins.
type Product = [Category, string[], (query: SmartQuery) => void];
const product = (category: Category, list: string[], apply: (query: SmartQuery) => void = () => {}): Product => [category, list, apply];
const products: Product[] = [
  // Cocktails before coffee and soft drinks: an Espresso Martini or a Gin Tonic is neither.
  product('cocktail', ['espresso martini'], q => { q.cocktailSelection = 'espresso_martini'; }),
  product('cocktail', ['gin tonic', 'gin and tonic', 'gin und tonic', 'gin & tonic', 'g&t'], q => { q.cocktailSelection = 'gin_tonic'; }),
  product('cocktail', ['aperol spritz', 'aperol', 'spritz', 'spritzer'], q => { q.cocktailSelection = 'aperol_spritz'; }),
  product('cocktail', ['hugo'], q => { q.cocktailSelection = 'hugo'; }),
  product('cocktail', ['negroni'], q => { q.cocktailSelection = 'negroni'; }),
  product('cocktail', ['mojito', 'mojitos'], q => { q.cocktailSelection = 'mojito'; }),
  product('cocktail', ['moscow mule'], q => { q.cocktailSelection = 'moscow_mule'; }),
  product('cocktail', ['margarita', 'margaritas'], q => { q.cocktailSelection = 'margarita'; }),
  product('cocktail', ['caipirinha', 'caipi'], q => { q.cocktailSelection = 'caipirinha'; }),
  product('cocktail', ['mocktail', 'mocktails', 'virgin'], q => { q.cocktailSelection = 'mocktail'; }),
  product('cocktail', ['cocktail', 'cocktails', 'longdrink', 'longdrinks']),
  product('coffee', ['doppelter espresso', 'double espresso', 'doppio', 'doppelespresso'], q => { q.coffeeType = 'double'; }),
  product('coffee', ['espresso', 'espressi', 'espressos'], q => { q.coffeeType = 'espresso'; }),
  product('coffee', ['ristretto'], q => { q.coffeeType = 'ristretto'; }),
  product('coffee', ['cappuccino', 'cappuccini', 'cappu', 'capuccino', 'cappucino'], q => { q.coffeeType = 'cappuccino'; }),
  product('coffee', ['latte macchiato', 'latte', 'lmc'], q => { q.coffeeType = 'latte'; }),
  product('coffee', ['milchkaffee', 'schale', 'café au lait'], q => { q.coffeeType = 'milk'; }),
  product('coffee', ['flat white', 'flatwhite'], q => { q.coffeeType = 'flat_white'; }),
  product('coffee', ['americano'], q => { q.coffeeType = 'americano'; }),
  product('coffee', ['filterkaffee', 'filter kaffee', 'filter coffee', 'drip coffee'], q => { q.coffeeType = 'filter'; }),
  product('coffee', ['café crème', 'kafi crème', 'kaffee crème', 'crème', 'creme'], q => { q.coffeeType = 'creme'; }),
  product('coffee', ['matcha latte', 'matcha'], q => { q.coffeeType = 'matcha_latte'; }),
  product('coffee', ['kaffee', 'kaffees', 'kafi', 'kaffi', 'coffee', 'coffees']),
  product('softdrink', ['ginger beer'], q => { q.softdrinkSelection = 'ginger_beer'; }),
  product('softdrink', ['ginger ale'], q => { q.softdrinkSelection = 'ginger_ale'; }),
  product('softdrink', ['bitter lemon'], q => { q.softdrinkSelection = 'bitter_lemon'; }),
  product('softdrink', ['tonic water', 'tonic'], q => { q.softdrinkSelection = 'tonic'; }),
  product('softdrink', ['coca cola', 'cola', 'coke', 'cola zero'], q => { q.softdrinkSelection = 'cola'; }),
  product('softdrink', ['rivella'], q => { q.softdrinkSelection = 'rivella'; }),
  product('softdrink', ['fanta'], q => { q.softdrinkSelection = 'fanta'; }),
  product('softdrink', ['sprite'], q => { q.softdrinkSelection = 'sprite'; }),
  product('softdrink', ['eistee', 'ice tea', 'icetea', 'iced tea', 'fuse tea'], q => { q.softdrinkSelection = 'icetea'; }),
  product('softdrink', ['schorle', 'apfelschorle', 'süssmost schorle'], q => { q.softdrinkSelection = 'schorle'; }),
  product('softdrink', ['limonade', 'lemonade'], q => { q.softdrinkSelection = 'lemonade'; }),
  product('softdrink', ['softdrink', 'softdrinks', 'soft drink', 'soft drinks', 'softgetränk', 'softgetränke', 'limo', 'süssgetränk']),
  ...Object.entries(beerGroupLabels).filter(([, label]) => label.length >= 5).map(([key, label]) =>
    product('beer', [label, key.replace(/_/g, ' ')], q => { q.beerSelection = key as BeerSelection; })),
  product('beer', ['stange', 'stangen', 'stangeli', 'e stange'], q => { q.stange = true; }),
  product('beer', ['offenbier', 'vom fass', 'fassbier', 'gezapft', 'gezapftes', 'draft', 'draught', 'on tap', 'pression'], q => { q.beerType = 'draft'; }),
  product('beer', ['flaschenbier', 'flasche', 'flaschen', 'bottle', 'bottled', 'bouteille'], q => { q.beerType = 'bottle'; }),
  product('beer', ['dosenbier', 'dose', 'dosen', 'canned', 'canette'], q => { q.beerType = 'can'; }),
  product('beer', ['bier', 'biere', 'bierli', 'bierchen', 'beer', 'beers', 'bière', 'lager', 'lagerbier', 'pils', 'pilsner', 'helles', 'weizen', 'weissbier', 'ipa']),
  product('pizza', ['prosciutto e funghi', 'prosciutto funghi', 'schinken pilze'], q => { q.pizzaGroup = 'prosciutto_funghi'; }),
  product('pizza', ['prosciutto', 'schinkenpizza'], q => { q.pizzaGroup = 'prosciutto'; }),
  product('pizza', ['funghi', 'pilzpizza'], q => { q.pizzaGroup = 'funghi'; }),
  product('pizza', ['salami', 'salame'], q => { q.pizzaGroup = 'salami'; }),
  product('pizza', ['diavola', 'diavolo'], q => { q.pizzaGroup = 'diavola'; }),
  product('pizza', ['vegetariana', 'verdura', 'verdure'], q => { q.pizzaGroup = 'vegetariana'; }),
  product('pizza', ['quattro formaggi', '4 formaggi', 'vier käse'], q => { q.pizzaGroup = 'quattro_formaggi'; }),
  product('pizza', ['quattro stagioni', '4 stagioni', 'vier jahreszeiten'], q => { q.pizzaGroup = 'quattro_stagioni'; }),
  product('pizza', ['tonno', 'thon'], q => { q.pizzaGroup = 'tonno'; }),
  product('pizza', ['margherita', 'pizza margherita'], q => { q.margherita = true; }),
  product('pizza', ['pizza', 'pizzas', 'pizze', 'pizzen', 'pizzeria', 'pizzerias', 'pizzerien']),
  product('burger', ['burger', 'burgers', 'cheeseburger', 'hamburger', 'smash burger']),
  product('ramen', ['ramen', 'tonkotsu', 'shoyu', 'nudelsuppe', 'noodle soup']),
  product('kebab', ['falafel', 'falafels'], q => { q.streetfoodFood = q.streetfoodFood === 'doner' ? 'all' : 'falafel'; }),
  product('kebab', ['kebabteller', 'dönerteller', 'kebab teller', 'döner teller'], q => { q.plate = true; q.streetfoodFood = q.streetfoodFood === 'falafel' ? 'all' : 'doner'; }),
  product('kebab', ['kebab', 'kebap', 'döner', 'döner kebab', 'döner wrap', 'kebab wrap', 'dürüm', 'durum', 'yufka'], q => { q.streetfoodFood = q.streetfoodFood === 'falafel' ? 'all' : 'doner'; }),
];
const compiledProducts = products.map(([category, list, apply]) => [category, words(list), apply] as const);
const plate = words(['teller', 'plate', 'platte', 'assiette']);

// Quarter names that people use, mapped to the official numbers in districts.json.
// Words that are also beers (Felsenau) or everyday words stay out.
export const districtAliases: Partial<Record<City, Record<number, string[]>>> = {
  zurich: {
    1: ['altstadt', 'niederdorf', 'rathaus', 'lindenhof', 'hochschulen'], 2: ['enge', 'wollishofen', 'leimbach'],
    3: ['wiedikon', 'alt wiedikon', 'friesenberg', 'sihlfeld'], 4: ['aussersihl', 'langstrassenquartier', 'werd'],
    5: ['industriequartier', 'gewerbeschule', 'escher wyss', 'zürich west', 'züri west'], 6: ['unterstrass', 'oberstrass'],
    7: ['fluntern', 'hottingen', 'hirslanden', 'witikon'], 8: ['riesbach', 'seefeld', 'mühlebach', 'weinegg'],
    9: ['altstetten', 'albisrieden'], 10: ['wipkingen', 'höngg'], 11: ['oerlikon', 'affoltern', 'seebach'], 12: ['schwamendingen', 'saatlen', 'hirzenbach'],
  },
  bern: {
    1: ['innere stadt', 'innenstadt', 'altstadt'], 2: ['länggasse', 'länggass', 'länggasse felsenau'], 3: ['mattenhof', 'weissenbühl', 'mattenhof weissenbühl', 'monbijou'],
    4: ['kirchenfeld', 'schosshalde', 'kirchenfeld schosshalde'], 5: ['breitenrain', 'lorraine', 'breitenrain lorraine'], 6: ['bümpliz', 'oberbottigen', 'bethlehem', 'bümpliz oberbottigen'],
  },
  basel: {
    1: ['altstadt grossbasel', 'grossbasel'], 2: ['vorstädte'], 3: ['am ring'], 4: ['breite'], 5: ['st. alban', 'sankt alban'],
    6: ['gundeldingen', 'gundeli'], 7: ['bruderholz'], 8: ['bachletten'], 9: ['gotthelf'], 10: ['iselin'], 11: ['st. johann', 'sankt johann'],
    12: ['altstadt kleinbasel', 'kleinbasel'], 13: ['clara'], 14: ['wettstein'], 15: ['hirzbrunnen'], 16: ['rosental'], 17: ['matthäus'], 18: ['klybeck'], 19: ['kleinhüningen'],
  },
  winterthur: { 1: ['winterthur stadt', 'altstadt'], 2: ['oberwinterthur'], 3: ['seen'], 4: ['töss'], 5: ['veltheim'], 6: ['wülflingen'], 7: ['mattenbach'] },
  lausanne: {
    1: ['centre', 'flon'], 2: ['maupas', 'valency'], 3: ['sébeillon', 'malley'], 4: ['montoie', 'bourdonnette'], 5: ['montriond'], 6: ['sous gare', 'ouchy'],
    7: ['montchoisi'], 8: ['florimont', 'chissiez'], 9: ['mousquines', 'bellevue'], 10: ['vallon', 'béthusy'], 11: ['chailly', 'rovéréaz'],
    12: ['sallaz', 'vennes', 'séchaud'], 13: ['sauvabelin'], 14: ['bellevaux'], 15: ['vinet', 'pontaise'], 16: ['bossons', 'blécherette'], 17: ['beaulieu', 'boisy'],
  },
  geneva: {
    1: ['grottes', 'saint gervais', 'st gervais'], 2: ['acacias', 'bâtie'], 3: ['plainpalais', 'jonction'], 4: ['eaux vives', 'cité', 'vieille ville'],
    5: ['saint jean', 'st jean', 'charmilles'], 6: ['champel'], 7: ['servette', 'petit saconnex'], 8: ['pâquis', 'sécheron'],
  },
};
const districtPatterns = new Map<City, [number, RegExp][]>();
function districtTable(city: City): [number, RegExp][] {
  if (!districtPatterns.has(city)) districtPatterns.set(city, Object.entries(districtAliases[city] || {}).map(([n, list]) => [Number(n), words(list)]));
  return districtPatterns.get(city)!;
}

const stopwords = new Set(['wo', 'gibt', 'gibts', 'es', 'ein', 'eine', 'einen', 'einem', 'einer', 'eis', 'en', 'e', 'der', 'die', 'das', 'den', 'dem', 'des', 'mit', 'und', 'oder', 'im', 'in', 'am', 'an', 'auf', 'bei', 'beim', 'zum', 'zur', 'zu', 'von', 'vom', 'fur', 'um', 'ab', 'bis', 'ich', 'mir', 'mich', 'man', 'bitte', 'heute', 'gut', 'gute', 'guter', 'gutes', 'guten', 'beste', 'besten', 'bestes', 'finde', 'finden', 'suche', 'suchen', 'zeig', 'zeige', 'zeigen', 'mal', 'noch', 'nur', 'sehr', 'so', 'ganz', 'kann', 'wie', 'was', 'welche', 'welcher', 'welches', 'wer', 'hat', 'haben', 'ist', 'sind', 'uhr', 'glas', 'tasse', 'lokal', 'lokale', 'ort', 'orte', 'platz', 'trinken', 'essen', 'etwas', 'öppis', 'irgendwo', 'stadt',
  'the', 'a', 'an', 'with', 'at', 'for', 'me', 'my', 'show', 'find', 'where', 'is', 'are', 'some', 'any', 'get', 'i', 'to', 'of', 'and', 'or', 'can', 'place', 'places', 'spot', 'spots', 'good', 'best', 'cup', 'glass', 'something', 'city', 'area',
  'le', 'la', 'les', 'un', 'une', 'du', 'de', 'avec', 'et', 'ou', 'pour', 'chf', 'fr', 'franken', 'francs', 'franc', 'stutz',
  'zurich', 'zuri', 'bern', 'basel', 'winterthur', 'winti', 'olten', 'luzern', 'lucerne', 'lausanne', 'geneve', 'genf', 'geneva'].map(normalizeSmart));

export function parseSmartQuery(text: string, city: City): SmartQuery {
  const query: SmartQuery = { rest: [] };
  let s = ` ${normalizeSmart(text)} `;
  // Taking a match blanks it out, so later rules cannot read it again and positions stay comparable.
  const take = (pattern: RegExp, use: (match: RegExpExecArray) => boolean | void) => {
    pattern.lastIndex = 0;
    const found = [...s.matchAll(pattern)];
    for (const match of found) if (use(match) !== false) s = s.slice(0, match.index) + ' '.repeat(match[0].length) + s.slice(match.index! + match[0].length);
  };
  const price = (value: string) => {
    const amount = Number(value);
    if (!(amount >= 0.5 && amount <= 200)) return false;
    query.max = amount;
  };
  take(priceAfterKeyword, match => price(match[1]));
  take(priceWithCurrency, match => price(match[1] || match[2]));
  take(timeOfDay, ([, word, hours, mins, unit]) => {
    // Only "um" is clear on its own; "at 9" or "nach 5" needs a unit or minutes.
    if (word !== 'um' && !mins && !unit) return false;
    let hour = Number(hours);
    if (unit === 'pm' && hour < 12) hour += 12;
    if (unit === 'am' && hour === 12) hour = 0;
    if (hour > 24 || Number(mins || 0) > 59) return false;
    // "Open until 22:00" asks for a venue that is still open half an hour before.
    const at = (hour * 60 + Number(mins || 0) - (word === 'bis' || word === 'until' ? 30 : 0) + 1440) % 1440;
    query.open = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
  });
  for (const [time, pattern] of times) take(pattern, () => { query.open ??= time; });
  take(openNow, () => { query.open ??= 'now'; });
  const aliases = districtTable(city);
  take(districtNumber, match => {
    const n = Number(match[1]);
    if (!aliases.some(([number]) => number === n)) return false;
    query.district = n;
  });
  for (const [n, pattern] of aliases) take(pattern, () => { query.district ??= n; });
  take(near, () => { query.near = true; });
  take(outdoor, () => { query.outdoor = true; });
  take(cheap, () => { query.cheap = true; });
  for (const [diet, pattern] of diets) take(pattern, () => { query.diet ??= diet; });
  take(glutenFree, () => { query.glutenFree = true; });
  take(alcoholFree, () => { query.alcoholFree = true; });
  take(volume, ([, amount, unit]) => {
    const ml = Math.round(Number(amount) * (unit === 'dl' ? 100 : unit === 'cl' ? 10 : 1000));
    if (ml < 100 || ml > 1000) return false;
    query.volumeMl = ml;
  });
  let beerSize = false;
  for (const [[ml, beer], pattern] of beerSizes) take(pattern, () => { query.volumeMl ??= ml; beerSize ||= beer; });
  // Collect every product, then keep the details of the category named first.
  const named: { category: Category; index: number; apply: (query: SmartQuery) => void }[] = [];
  for (const [category, pattern, apply] of compiledProducts) take(pattern, match => { named.push({ category, index: match.index!, apply }); });
  const first = named.sort((a, b) => a.index - b.index)[0];
  if (first) {
    query.drink = first.category;
    for (const item of named) if (item.category === first.category) item.apply(query);
  } else if (beerSize) query.drink = 'beer';
  take(plate, () => { query.plate = true; });
  take(cafe, () => { query.cafe = true; });
  for (const [type, pattern] of venueTypes) take(pattern, () => { query.type ??= type; });
  const leftover = s.split(' ').filter(word => word && !stopwords.has(word) && !/^[.:<]+$/.test(word));
  // Report leftovers in the visitor's spelling where a typed word normalises to the same text.
  const typed = text.split(/[\s,;!?()«»"]+/).filter(Boolean);
  query.rest = leftover.map(word => typed.find(original => normalizeSmart(original) === word) || word);
  return query;
}

// True when the rules understood anything beyond plain words.
export function isSmartQuery(query: SmartQuery): boolean {
  return Object.entries(query).some(([key, value]) => key !== 'rest' && value !== undefined && value !== false);
}

export function planSmartQuery(query: SmartQuery, available: ReadonlySet<Category>, current: Category): SmartPlan {
  let drink = query.drink;
  let unavailable: Category | undefined;
  if (drink && !available.has(drink)) { unavailable = drink; drink = undefined; }
  // A diet or alcohol-free without a product names the category that offers it.
  if (!drink && !unavailable) {
    if (query.diet) drink = available.has('burger') ? 'burger' : available.has('pizza') ? 'pizza' : undefined;
    else if (query.alcoholFree) drink = 'beer';
    else if (query.cafe) drink = 'coffee';
  }
  const target = drink || current;
  const filters: Partial<Filters> = {
    outdoor: Boolean(query.outdoor), open: query.open, district: query.district,
    type: query.type || (query.cafe && target !== 'coffee' ? 'cafe' : ''),
    max: query.max ?? Infinity,
    ...(query.near ? { sort: 'distance' } : {}),
  };
  if (drink) Object.assign(filters, { drink, mode: 'glass' as const });
  if (target === 'coffee' && (drink || query.coffeeType)) filters.coffeeType = query.coffeeType || 'all';
  if (target === 'beer') {
    const size = query.stange ? 'stange' : query.volumeMl === 300 ? '300-330' : query.volumeMl === 330 ? '330' : query.volumeMl === 400 ? '400' : query.volumeMl === 500 ? '500' : undefined;
    Object.assign(filters, {
      beerType: query.beerType || 'all', beerSelection: query.beerSelection, beerQuery: undefined,
      alcoholFree: Boolean(query.alcoholFree), glutenFree: Boolean(query.glutenFree),
      // Like the size and serving choices in the toolbar: a brand or bottles compare every size, draft opens at the Stange.
      volume: size || (query.beerSelection || query.beerType === 'bottle' || query.beerType === 'can' ? 'all' : query.beerType === 'draft' ? 'stange' : '300-330'),
    });
  }
  if (target === 'pizza') {
    const selection: PizzaSelection | undefined = query.glutenFree ? 'glutenfree' : query.diet === 'vegan' ? 'group:vegan'
      : query.diet === 'vegetarian' ? 'group:vegetariana' : query.pizzaGroup ? `group:${query.pizzaGroup}` : undefined;
    Object.assign(filters, { pizzaSelection: selection, pizzaQuery: undefined });
  }
  if (target === 'burger') filters.burgerSelection = query.glutenFree ? 'glutenfree' : query.diet || 'all';
  if (target === 'softdrink') {
    const size: SoftdrinkSize | undefined = query.volumeMl === 200 ? '200' : query.volumeMl === 500 ? '500' : query.volumeMl === 300 || query.volumeMl === 330 ? '300-330' : undefined;
    Object.assign(filters, { softdrinkSelection: query.softdrinkSelection || 'all', ...(size ? { softdrinkSize: size } : {}) });
  }
  if (target === 'cocktail') filters.cocktailSelection = query.alcoholFree ? 'mocktail' : query.cocktailSelection || 'all';
  if (target === 'kebab') {
    const portion: StreetfoodPortion | undefined = query.plate ? 'plate' : undefined;
    Object.assign(filters, { streetfoodFood: query.streetfoodFood === 'all' ? undefined : query.streetfoodFood, ...(portion ? { streetfoodPortion: portion } : {}) });
  }
  // A price of its own replaces the cheap filter; otherwise the result opens at its cheap price like a category switch.
  return { filters, cheap: query.max === undefined, near: Boolean(query.near), ...(unavailable ? { unavailable } : {}) };
}

type Example = { de: string; en: string; needs: Category; place?: boolean };
const examples: Example[] = [
  { de: 'Stange unter 5 Franken {place}', en: 'Stange under 5 francs {place}', needs: 'beer', place: true },
  { de: 'Cappuccino jetzt offen in der Nähe', en: 'Cappuccino open now near me', needs: 'coffee' },
  { de: 'Espresso unter 4 Franken mit Terrasse', en: 'Espresso under 4 francs with a terrace', needs: 'coffee' },
  { de: 'Margherita bis 18 Franken {place}', en: 'Margherita up to 18 francs {place}', needs: 'pizza', place: true },
  { de: 'Aperol Spritz draussen, jetzt offen', en: 'Aperol Spritz outside, open now', needs: 'cocktail' },
  { de: 'Vegi Burger unter 20 Franken', en: 'Veggie burger under 20 francs', needs: 'burger' },
  { de: 'Bier vom Fass um 23 Uhr offen', en: 'Draft beer open at 11 pm', needs: 'beer' },
  { de: 'Flat White {place}', en: 'Flat white {place}', needs: 'coffee', place: true },
  { de: 'Alkoholfreies Bier mit Terrasse', en: 'Alcohol-free beer with a terrace', needs: 'beer' },
  { de: 'Dürüm unter 12 Franken, jetzt offen', en: 'Döner wrap under 12 francs, open now', needs: 'kebab' },
  { de: 'Ramen über Mittag', en: 'Ramen for lunch', needs: 'ramen' },
  { de: 'Cola unter 5 Franken {place}', en: 'Cola under 5 francs {place}', needs: 'softdrink', place: true },
  { de: 'Günstigster Kaffee in der Nähe', en: 'Cheapest coffee near me', needs: 'coffee' },
  { de: '5 dl Bier unter 8 Franken, jetzt offen', en: 'Pint under 8 francs, open now', needs: 'beer' },
  { de: 'Pizza Diavola mit Gartenwirtschaft', en: 'Pizza diavola with a garden', needs: 'pizza' },
];
const places: Partial<Record<City, { de: string; en: string }[]>> = {
  zurich: [{ de: 'im Kreis 4', en: 'in Kreis 4' }, { de: 'in Wiedikon', en: 'in Wiedikon' }, { de: 'in Oerlikon', en: 'in Oerlikon' }, { de: 'im Seefeld', en: 'in Seefeld' }, { de: 'im Kreis 5', en: 'in Kreis 5' }],
  bern: [{ de: 'in der Länggasse', en: 'in Länggasse' }, { de: 'im Breitenrain', en: 'in Breitenrain' }, { de: 'in der Lorraine', en: 'in Lorraine' }],
  basel: [{ de: 'im Gundeli', en: 'in Gundeldingen' }, { de: 'im Kleinbasel', en: 'in Kleinbasel' }, { de: 'im St. Johann', en: 'in St. Johann' }],
  winterthur: [{ de: 'in Töss', en: 'in Töss' }, { de: 'in Oberwinterthur', en: 'in Oberwinterthur' }, { de: 'in Veltheim', en: 'in Veltheim' }],
  lausanne: [{ de: 'in Ouchy', en: 'in Ouchy' }, { de: 'im Flon', en: 'in the Flon' }, { de: 'in Chailly', en: 'in Chailly' }],
  geneva: [{ de: 'in Plainpalais', en: 'in Plainpalais' }, { de: 'in den Pâquis', en: 'in the Pâquis' }, { de: 'in Eaux-Vives', en: 'in Eaux-Vives' }],
};

// Example sentences for the search field, in random order, only for categories the city shows.
export function smartExamples(city: City, locale: Locale, available: ReadonlySet<Category>, random = Math.random): string[] {
  const cityPlaces = places[city] || [];
  const list = examples.filter(example => available.has(example.needs)).map(example => {
    const place = cityPlaces.length ? cityPlaces[Math.floor(random() * cityPlaces.length)][locale] : '';
    return example[locale].replace(' {place}', example.place && place ? ` ${place}` : '');
  });
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
