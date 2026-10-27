export const pizzaGroupLabels = {
  prosciutto: 'Prosciutto',
  funghi: 'Funghi',
  prosciutto_funghi: 'Prosciutto e Funghi',
  salami: 'Salami',
  diavola: 'Diavola',
  vegetariana: 'Vegetariana / Verdura',
  vegan: 'Vegan',
  quattro_formaggi: 'Quattro Formaggi',
  quattro_stagioni: 'Quattro Stagioni',
  tonno: 'Tonno',
} as const;
export type PizzaGroup = keyof typeof pizzaGroupLabels;
export type PizzaSelection = 'all' | 'glutenfree' | `group:${PizzaGroup}` | `name:${string}`;

const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

// Match sourced ingredients in German, Italian and English. Unknown house names
// are fine; absence of meat words alone is never enough to call a pizza vegetables.
export function pizzaGroup(item: { name: string; ingredients?: string; pizzaType?: string }): PizzaGroup | undefined {
  if (item.pizzaType !== 'other') return undefined;
  const name = pizzaNameKey(item.name).replace(/[-&]+/g, ' ').trim();
  const ingredients = normalize(item.ingredients || '').trim();
  // Use an explicit menu label; missing cheese alone does not establish vegan ingredients.
  const vegan = /\bvegan\w*\b/.test(`${name} ${ingredients}`);
  if (!ingredients) {
    if (vegan) return 'vegan';
    if (/^(?:al |ai )?(?:prosciutto|schinken)(?: e | und | +)(?:funghi|pilze)$/.test(name)) return 'prosciutto_funghi';
    if (/^(?:al )?(?:prosciutto(?: cotto)?|schinken)$/.test(name)) return 'prosciutto';
    if (/^(?:ai )?(?:funghi|champignons|pilze)$/.test(name)) return 'funghi';
    if (/^(?:salami|salame)$/.test(name)) return 'salami';
    if (/^diavol[ao]$/.test(name)) return 'diavola';
    if (/^(?:vegetariana|vegetarisch|ortolana|verdura|verdure|4 verdure)$/.test(name)) return 'vegetariana';
    if (/^(?:al )?(?:4|quattro|vier|four) (?:formaggi|kase|cheeses?)$/.test(name)) return 'quattro_formaggi';
    if (/^(?:4|quattro|vier|four) (?:stagion[ie]|jahreszeiten|seasons)$/.test(name)) return 'quattro_stagioni';
    if (/^(?:al )?(?:tonno|thon|thunfisch)(?: e cipolla)?$/.test(name)) return 'tonno';
    return undefined;
  }
  const ham = /\b(?:\w*schinken|prosciutto|ham|jambon)\b/.test(ingredients);
  const salami = /\b(?:salam[ei]|pepperoni|spianata)\b/.test(ingredients);
  const tuna = /\b(?:tonno|thon|thunfisch|tuna)\b/.test(ingredients);
  const mushrooms = /\b(?:\w*pilz\w*|champignon\w*|funghi|porcini|mushrooms?|portobello)\b/.test(ingredients);
  const artichokes = /\b(?:artischock\w*|carciof\w*|artichokes?)\b/.test(ingredients);
  const otherMeat = /\b(?:rohschinken|parma\w*|crudo|speck|bacon|pancetta|bresaola|mortadella|salumi|salsiccia|sausage|wurst\w*|\w*fleisch|poulet\w*|chicken|pollo|beef|manzo|veal|vitello|kalb\w*|lamm\w*|agnello|lamb|schwein\w*|pork|truthahn|turkey|tacchino|pastrami|nduja|chorizo|merguez)\b/.test(ingredients);
  const seafood = /\b(?:sardell\w*|acciugh\w*|alici|anchov\w*|meeresfrucht\w*|frutti di mare|seafood|gamber\w*|crevett\w*|shrimps?|prawns?|lachs\w*|salmon\w*|salmone|polpo|octopus|calamar\w*|muschel\w*|cozze|vongole|surimi)\b/.test(ingredients);
  const special = /\b(?:ananas|pineapple|tartuf\w*|truff\w*|truf\w*|birne\w*|pears?|pere|feige\w*|figs?|fichi|trauben|grapes?|uva|pistac\w*|pistaz\w*|waln\w*|noci|nocciole|nut\w*|honig|honey|miele|ei|eier|egg\w*|uov[ao])\b/.test(ingredients);
  const vegetables = [
    /\b(?:aubergin\w*|melanzan\w*|eggplant\w*)\b/,
    /\b(?:zucc?h(?:in|ett)\w*|courgette\w*)\b/,
    /\b(?:peperoni|paprika|bell peppers?|pimientos?)\b/,
    /\b(?:spinat|spinaci|spinach)\b/,
    /\b(?:broccoli|brokkoli|friarielli|friarelli)\b/,
    /\b(?:mais|corn|sweetcorn)\b/,
    /\b(?:kartoffel\w*|patat\w*|potato\w*)\b/,
    /\b(?:spargel|asparag\w*|asparagus)\b/,
  ].filter(pattern => pattern.test(ingredients)).length;
  const mixedVegetables = /\b(?:\w*gemuse|verdure|mixed vegetables|seasonal vegetables|grilled vegetables)\b/.test(ingredients);
  const meatFree = !ham && !salami && !tuna && !otherMeat && !seafood;
  const seasonsName = /\b(?:4|quattro|vier|four) (?:stagion[ie]|jahreszeiten|seasons)\b/.test(name);
  const mozzarella = /\b(?:\w*mozzarella|bufala|fior ?di ?latte)\b/.test(ingredients);

  if (vegan) return meatFree ? 'vegan' : undefined;
  if (otherMeat || seafood || special) return undefined;
  if (ham && mushrooms && (artichokes || seasonsName) && !tuna) return 'quattro_stagioni';
  if (meatFree && mozzarella && (mixedVegetables || vegetables + Number(artichokes) + Number(mushrooms) >= 2)) return 'vegetariana';
  if (vegetables || mixedVegetables || artichokes) return undefined;
  if (ham && !salami && !tuna) return mushrooms ? 'prosciutto_funghi' : 'prosciutto';
  if (salami && !ham && !tuna && !mushrooms) {
    return /\b(?:scharf\w*|pikant\w*|piccant\w*|spicy|hot|chill?i\w*|peperoncin\w*)\b/.test(`${ingredients} ${name}`) || /^diavol[ao]$/.test(name)
      ? 'diavola' : 'salami';
  }
  if (tuna && !ham && !salami && !mushrooms) return 'tonno';
  if (!meatFree) return undefined;
  if (mushrooms) return 'funghi';
  const cheeses = [
    /\b(?:mozzarella|bufala|buffalo mozzarella|fior ?di ?latte)\b/,
    /\bgorgonzola\b/, /\btaleggio\b/, /\b(?:parmesan\w*|parmigiano|grana)\b/,
    /\b(?:emmental\w*)\b/, /\bgruyere\b/, /\bricotta\b/,
    /\b(?:provola|provolone)\b/, /\bscamorza\b/, /\bfontina\b/, /\bpecorino\b/,
  ].filter(pattern => pattern.test(ingredients)).length;
  if (cheeses >= 4 || /\b(?:4|quattro|vier|four) (?:\w+ )?(?:formaggi|kase\w*|cheeses?)\b/.test(ingredients)
    || (cheeses >= 2 && /\b(?:4|quattro|vier|four) formaggi\b/.test(name))) return 'quattro_formaggi';
  return undefined;
}

export function pizzaName(name: string): string {
  return name.trim().replace(/^(?:\d{2,3}[a-z]?[.)]?|\d[.)]|\d(?=\s+pizza\b))\s+/i, '')
    .replace(/^pizza\s+/i, '').trim();
}

export function pizzaNameKey(name: string): string {
  return pizzaName(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
}

export function parsePizzaSelection(value: string | null): PizzaSelection | undefined {
  if (value === 'all' || value === 'glutenfree') return value;
  if (value?.startsWith('group:') && Object.hasOwn(pizzaGroupLabels, value.slice(6))) return value as PizzaSelection;
  if (value?.startsWith('name:')) {
    const name = pizzaNameKey(value.slice(5));
    if (name && name.length <= 100) return `name:${name}`;
  }
  return undefined;
}
