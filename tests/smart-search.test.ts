import { describe, expect, it } from 'vitest';
import { isSmartQuery, normalizeSmart, parseSmartQuery, planSmartQuery, smartExamples } from '../src/smart-search';
import { categories, type Category } from '../src/categories';
import { cities, type City } from '../src/cities';

const all = new Set<Category>(categories);
const parse = (text: string, city: City = 'zurich') => parseSmartQuery(text, city);

describe('parseSmartQuery', () => {
  it('reads category, price, district, time and outdoor seating from one sentence', () => {
    const query = parse('Bier unter 6 Franken in Kreis 4, jetzt offen, mit Terrasse');
    expect(query).toMatchObject({ drink: 'beer', max: 6, district: 4, open: 'now', outdoor: true, rest: [] });
  });

  it('understands Swiss price spellings and keeps sizes and districts apart from prices', () => {
    expect(parse('Stange für 4.50').max).toBeUndefined();
    expect(parse('Stange 4.50 Fr.').max).toBe(4.5);
    expect(parse('Kafi max. CHF 4,20').max).toBe(4.2);
    expect(parse('Cappuccino bis 5.-').max).toBe(5);
    expect(parse('Espresso < 4').max).toBe(4);
    expect(parse('Bier bis 5 dl')).toMatchObject({ volumeMl: 500 });
    expect(parse('Bier bis 5 dl').max).toBeUndefined();
    expect(parse('Kreis 4')).toMatchObject({ district: 4 });
    expect(parse('Kreis 4').max).toBeUndefined();
    expect(parse('5 Stutz Bier').max).toBe(5);
  });

  it('takes the products of the first category and leaves later ones out', () => {
    expect(parse('Espresso Martini')).toMatchObject({ drink: 'cocktail', cocktailSelection: 'espresso_martini' });
    expect(parse('Gin Tonic draussen')).toMatchObject({ drink: 'cocktail', cocktailSelection: 'gin_tonic', outdoor: true });
    expect(parse('Ginger Beer')).toMatchObject({ drink: 'softdrink', softdrinkSelection: 'ginger_beer' });
    expect(parse('Pizza und Bier')).toMatchObject({ drink: 'pizza', rest: [] });
    expect(parse('Quöllfrisch vom Fass')).toMatchObject({ drink: 'beer', beerSelection: 'quollfrisch', beerType: 'draft' });
    expect(parse('Dürüm und Falafel')).toMatchObject({ drink: 'kebab', streetfoodFood: 'all' });
    expect(parse('Kebabteller')).toMatchObject({ drink: 'kebab', streetfoodFood: 'doner', plate: true });
    expect(parse('Margherita')).toMatchObject({ drink: 'pizza', margherita: true });
    expect(parse('Margarita')).toMatchObject({ drink: 'cocktail', cocktailSelection: 'margarita' });
    expect(parse('ein grosses Bier')).toMatchObject({ drink: 'beer', volumeMl: 500 });
    expect(parse('Pint under 8 francs')).toMatchObject({ drink: 'beer', volumeMl: 500, max: 8 });
  });

  it('reads opening times as now or as a time of day', () => {
    expect(parse('Bier um 23 Uhr').open).toBe('23:00');
    expect(parse('draft beer open at 11 pm').open).toBe('23:00');
    expect(parse('Kafi ab 7:30').open).toBe('07:30');
    expect(parse('Pizza offen bis 22 Uhr').open).toBe('21:30');
    expect(parse('Ramen über Mittag').open).toBe('12:15');
    expect(parse('Bier spät').open).toBe('23:00');
    expect(parse('Offenbier').open).toBeUndefined();
  });

  it('maps quarter names to the official numbers of each city', () => {
    expect(parse('Pizza in Wiedikon').district).toBe(3);
    expect(parse('Bier im Seefeld').district).toBe(8);
    expect(parse('Kaffee in Oerlikon').district).toBe(11);
    expect(parse('Kafi im Gundeli', 'basel').district).toBe(6);
    expect(parse('Bier im St. Johann', 'basel').district).toBe(11);
    expect(parse('Bier in der Länggasse', 'bern').district).toBe(2);
    expect(parse('beer in Pâquis', 'geneva').district).toBe(8);
    expect(parse('Kreis 13').district).toBeUndefined();
    expect(parse('Bier im Kreis 4', 'olten').district).toBeUndefined();
    // Felsenau is a Bernese beer before it is a quarter.
    expect(parse('Felsenau', 'bern')).toMatchObject({ drink: 'beer', beerSelection: 'felsenau' });
    expect(parse('Felsenau', 'bern').district).toBeUndefined();
  });

  it('keeps unknown words in the spelling typed and drops filler words', () => {
    expect(parse('Wo gibt es einen gemütlichen Kaffee?')).toMatchObject({ drink: 'coffee', rest: ['gemütlichen'] });
    expect(parse('Pizza Bella')).toMatchObject({ drink: 'pizza', rest: ['Bella'] });
    expect(parse('Kafi 8004')).toMatchObject({ drink: 'coffee', rest: ['8004'] });
    expect(isSmartQuery(parse('Café Mühli'))).toBe(true);
    expect(isSmartQuery(parse('Mühli'))).toBe(false);
  });

  it('normalises umlauts, decimals and units the same way for text and rules', () => {
    expect(normalizeSmart('Zürich, CHF 6,50! 5dl')).toBe('zurich chf 6.50 5 dl');
    expect(normalizeSmart('Fr. 5.- im Kreis4')).toBe('fr 5 chf im kreis 4');
  });
});

describe('planSmartQuery', () => {
  it('turns a query into the filters and opens at the cheap price without a price of its own', () => {
    const plan = planSmartQuery(parse('Stange im Kreis 4 mit Terrasse'), all, 'coffee');
    expect(plan.cheap).toBe(true);
    expect(plan.filters).toMatchObject({ drink: 'beer', volume: 'stange', beerType: 'all', district: 4, outdoor: true, max: Infinity, open: undefined, type: '' });
    expect(planSmartQuery(parse('Cappuccino bis 5 Franken'), all, 'beer')).toMatchObject({ cheap: false, filters: { drink: 'coffee', coffeeType: 'cappuccino', max: 5 } });
  });

  it('follows the toolbar for beer sizes and serving', () => {
    expect(planSmartQuery(parse('Bier vom Fass'), all, 'coffee').filters).toMatchObject({ beerType: 'draft', volume: 'stange' });
    expect(planSmartQuery(parse('Flaschenbier'), all, 'coffee').filters).toMatchObject({ beerType: 'bottle', volume: 'all' });
    expect(planSmartQuery(parse('Quöllfrisch'), all, 'coffee').filters).toMatchObject({ beerSelection: 'quollfrisch', volume: 'all' });
    expect(planSmartQuery(parse('alkoholfreies Bier'), all, 'coffee').filters).toMatchObject({ drink: 'beer', alcoholFree: true });
    expect(planSmartQuery(parse('alkoholfrei'), all, 'coffee').filters).toMatchObject({ drink: 'beer', alcoholFree: true });
  });

  it('applies diets to the category that offers them', () => {
    expect(planSmartQuery(parse('Vegi Burger'), all, 'coffee').filters).toMatchObject({ drink: 'burger', burgerSelection: 'vegetarian' });
    expect(planSmartQuery(parse('vegane Pizza'), all, 'coffee').filters).toMatchObject({ drink: 'pizza', pizzaSelection: 'group:vegan' });
    expect(planSmartQuery(parse('glutenfreie Pizza'), all, 'coffee').filters).toMatchObject({ pizzaSelection: 'glutenfree' });
    expect(planSmartQuery(parse('vegan'), new Set<Category>(['coffee', 'beer', 'pizza']), 'coffee').filters).toMatchObject({ drink: 'pizza', pizzaSelection: 'group:vegan' });
    expect(planSmartQuery(parse('Mojito alkoholfrei'), all, 'coffee').filters).toMatchObject({ cocktailSelection: 'mocktail' });
  });

  it('keeps the current category when the city does not show the one asked for', () => {
    const plan = planSmartQuery(parse('Cocktail jetzt offen'), new Set<Category>(['coffee', 'beer']), 'beer');
    expect(plan.unavailable).toBe('cocktail');
    expect(plan.filters.drink).toBeUndefined();
    expect(plan.filters.open).toBe('now');
  });

  it('uses the venue type for cafés only when another category is asked for', () => {
    expect(planSmartQuery(parse('Bier im Café'), all, 'coffee').filters).toMatchObject({ drink: 'beer', type: 'cafe' });
    expect(planSmartQuery(parse('Café in der Nähe'), all, 'beer')).toMatchObject({ near: true, filters: { drink: 'coffee', type: '', sort: 'distance' } });
  });
});

describe('smartExamples', () => {
  it('offers only examples for categories the city shows and that the rules fully understand', () => {
    for (const city of Object.keys(cities) as City[]) for (const locale of ['de', 'en'] as const) {
      const list = smartExamples(city, locale, all);
      expect(list.length).toBeGreaterThan(8);
      for (const example of list) {
        const query = parse(example, city);
        expect(query.rest, `${city} ${locale}: ${example}`).toEqual([]);
        expect(query.drink, example).toBeDefined();
        expect(example).not.toContain('{place}');
      }
    }
    expect(smartExamples('zurich', 'de', new Set<Category>(['coffee'])).every(example => parse(example).drink === 'coffee')).toBe(true);
  });
});
