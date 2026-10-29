import { describe, expect, it } from 'vitest';
import { cocktailGroup, parseCocktailSelection, parseSoftdrinkSelection, parseSoftdrinkSize, softdrinkGroups, softdrinkSizes } from '../src/gastro-selection';
import { cheapPriceLimit, cocktailVarieties, softdrinkVarieties, filterBars, matchingOffers, offerCategory, portion, type Bar, type Filters, type Offer } from '../src/data';
import { filtersFromSearch, writeFilters } from '../src/filters';
import { barLink, drinkFromSearch } from '../src/sharing';

const observedAt = '2026-10-28T23:02:02.301870+00:00';
const offer = (values: Partial<Offer> & Pick<Offer, 'name' | 'priceChf'>): Offer => ({
  volumeMl: null, sourceUrl: 'https://bar.example/karte.pdf', observedAt, confidence: 'ai', evidence: values.name,
  alcoholFree: false, ...values,
});
const soft = (name: string, priceChf: number, volumeMl: number | null) => offer({ name, priceChf, volumeMl, gastroType: 'softdrink' });
const drink = (name: string, priceChf: number) => offer({ name, priceChf, gastroType: 'cocktail' });
const venue = (id: string, offers: Offer[]): Bar => ({
  id, name: `Lokal ${id}`, lat: 47.37, lon: 8.54, type: 'bar', address: 'Langstrasse 1', postcode: '8004',
  website: 'https://bar.example/', openingHours: null, outdoor: false, offers, scrapeStatus: 'prices_found', checkedAt: observedAt,
});
const filters = (values: Partial<Filters> = {}): Filters => ({
  drink: 'softdrink', query: '', max: Infinity, volume: '300-330', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price', ...values,
});

describe('soft drinks', () => {
  it('belong to their own category and show their size', () => {
    const cola = soft('Coca Cola', 6.5, 330);
    expect(offerCategory(cola)).toBe('softdrink');
    expect(portion(cola)).toBe('3.3 dl');
    expect(portion(soft('Eistee', 5, null))).toBe('');
  });

  it('compares 3 and 3.3 dl by default and other sizes on request', () => {
    const bar = venue('node/1', [soft('Rivella Rot', 7.5, 500), soft('Coca Cola', 6.5, 330), soft('Fanta', 5, 200), soft('Sprite', 6, 300)]);
    expect(matchingOffers(bar, filters()).map(o => o.name)).toEqual(['Sprite', 'Coca Cola']);
    expect(matchingOffers(bar, filters({ softdrinkSize: '200' })).map(o => o.name)).toEqual(['Fanta']);
    expect(matchingOffers(bar, filters({ softdrinkSize: '500' })).map(o => o.name)).toEqual(['Rivella Rot']);
    expect(matchingOffers(bar, filters({ softdrinkSize: 'all' }))[0].name).toBe('Fanta');
  });

  it('ignores the beer filters and never mixes in beer', () => {
    const bar = venue('node/1', [soft('Coca Cola', 6.5, 330), offer({ name: 'Lager', priceChf: 5, volumeMl: 330 })]);
    expect(matchingOffers(bar, filters({ alcoholFree: true, volume: 'stange', mode: 'half' })).map(o => o.name)).toEqual(['Coca Cola']);
  });

  it('keeps the common CHF 5 out of cheap mode by using the cheapest fifth', () => {
    const prices = [[3.5, 2], [4, 12], [4.5, 10], [4.8, 7], [4.9, 5], [5, 55], [5.5, 33], [6, 35], [6.5, 13], [7, 8]]
      .flatMap(([price, count]) => Array.from({ length: count }, () => price));
    const bars = (type: 'softdrink' | 'cocktail') => prices.map((price, i) => venue(`node/${i}`, [offer({ name: 'Cola', priceChf: price, volumeMl: 330, gastroType: type })]));
    expect(cheapPriceLimit(bars('softdrink'), filters())).toBe(4.9);
    expect(cheapPriceLimit(bars('cocktail'), filters({ drink: 'cocktail' }))).toBe(5);
  });

  it('parses only known sizes', () => {
    expect(softdrinkSizes).toEqual(['300-330', '200', '500', 'all']);
    expect(parseSoftdrinkSize('500')).toBe('500');
    expect(parseSoftdrinkSize('330')).toBeUndefined();
    expect(parseSoftdrinkSize('toString')).toBeUndefined();
    expect(parseSoftdrinkSize(null)).toBeUndefined();
  });
});

describe('soft drink selection', () => {
  it('groups soft drinks by their sourced name, also when a menu lists several', () => {
    expect(softdrinkGroups('Coca Cola')).toEqual(['cola']);
    expect(softdrinkGroups('Coca-Cola Zero')).toEqual(['cola_zero']);
    expect(softdrinkGroups('Coca Cola / Zero')).toEqual(['cola', 'cola_zero']);
    expect(softdrinkGroups('Rivella rot oder blau')).toEqual(['rivella']);
    expect(softdrinkGroups('Hausgemachter Eistee')).toEqual(['icetea']);
    expect(softdrinkGroups('Schweppes Tonic / Bitter Lemon')).toEqual(['tonic', 'bitter_lemon']);
    expect(softdrinkGroups('Pepsi Zero Sugar')).toEqual([]);
    expect(parseSoftdrinkSelection('cola')).toBe('cola');
    expect(parseSoftdrinkSelection('constructor')).toBeUndefined();
  });

  it('combines the drink with the size and hides venues without it', () => {
    const bars = [
      venue('node/1', [soft('Coca Cola', 6.5, 330), soft('Fanta', 5, 330), soft('Coca Cola', 4, 200)]),
      venue('node/2', [soft('Rivella Rot', 5.5, 330)]),
    ];
    const f = filters({ softdrinkSelection: 'cola' });
    expect(matchingOffers(bars[0], f).map(o => o.priceChf)).toEqual([6.5]);
    expect(matchingOffers(bars[0], { ...f, softdrinkSize: 'all' }).map(o => o.priceChf)).toEqual([4, 6.5]);
    expect(filterBars(bars, f).map(bar => bar.id)).toEqual(['node/1']);
    expect(filterBars(bars, filters()).map(bar => bar.id)).toEqual(['node/1', 'node/2']);
  });

  it('offers a soft drink once three venues list it', () => {
    const bars = ['1', '2', '3'].map(id => venue(`node/${id}`, [soft('Coca Cola / Zero', 6, 330), soft('Fanta', 6, 330)]));
    bars[2].offers.pop();
    expect(softdrinkVarieties(bars).map(option => option.value)).toEqual(['cola', 'cola_zero']);
  });
});

describe('cocktails', () => {
  it('groups the classics by their sourced name', () => {
    expect(cocktailGroup('Aperol Spritz')).toBe('aperol_spritz');
    expect(cocktailGroup('Gin & Tonic')).toBe('gin_tonic');
    expect(cocktailGroup('Gin Tonic Hendrick’s')).toBe('gin_tonic');
    expect(cocktailGroup('Negroni Sbagliato')).toBe('negroni');
    expect(cocktailGroup('Espresso Martini')).toBe('espresso_martini');
    expect(cocktailGroup('Martini Bianco')).toBeUndefined();
    expect(cocktailGroup('Pizza Margherita')).toBeUndefined();
    expect(parseCocktailSelection('mojito')).toBe('mojito');
    expect(parseCocktailSelection('constructor')).toBeUndefined();
  });

  it('lists all cocktails by default and one classic on request', () => {
    const bar = venue('node/1', [drink('Negroni', 16), drink('Aperol Spritz', 13), drink('House Special', 18)]);
    const f = filters({ drink: 'cocktail' });
    expect(matchingOffers(bar, f).map(o => o.name)).toEqual(['Aperol Spritz', 'Negroni', 'House Special']);
    expect(matchingOffers(bar, { ...f, cocktailSelection: 'negroni' }).map(o => o.name)).toEqual(['Negroni']);
  });

  it('hides venues without the chosen classic, like a pizza selection', () => {
    const bars = [venue('node/1', [drink('Negroni', 16)]), venue('node/2', [drink('Mojito', 15)])];
    expect(filterBars(bars, filters({ drink: 'cocktail' })).map(bar => bar.id)).toEqual(['node/2', 'node/1']);
    expect(filterBars(bars, filters({ drink: 'cocktail', cocktailSelection: 'negroni' })).map(bar => bar.id)).toEqual(['node/1']);
  });

  it('offers a classic once three venues list it', () => {
    const bars = ['1', '2', '3'].map(id => venue(`node/${id}`, [drink('Aperol Spritz', 13), drink('Mojito', 15)]));
    bars[2].offers.pop();
    bars.push(venue('node/4', [drink('Negroni', 16), drink('Negroni', 17), drink('Negroni', 18)]));
    expect(cocktailVarieties(bars)).toEqual([{ value: 'aperol_spritz', label: 'Aperol Spritz' }]);
  });
});

describe('links', () => {
  it('keep the category and its selection', () => {
    const params = new URLSearchParams('drink=softdrink&softdrinkSize=500');
    expect(drinkFromSearch(params)).toBe('softdrink');
    const f = filtersFromSearch(params);
    expect(f.softdrinkSize).toBe('500');
    const written = new URLSearchParams();
    writeFilters(written, { ...f, softdrinkSize: '300-330' }, false);
    expect(written.has('softdrinkSize')).toBe(false);
    expect(written.get('drink')).toBe('softdrink');
    const cocktailLink = new URL(barLink('https://wobillig.ch/?drink=cocktail&cocktailSelection=hugo', 'node/1', 'cocktail', '300-330'));
    expect(cocktailLink.searchParams.get('cocktailSelection')).toBe('hugo');
    expect(new URL(barLink('https://wobillig.ch/?cocktailSelection=hugo', 'node/1', 'softdrink', '300-330')).searchParams.has('cocktailSelection')).toBe(false);
    expect(filtersFromSearch(new URLSearchParams('drink=softdrink&softdrinkSelection=cola')).softdrinkSelection).toBe('cola');
    const softdrinkLink = new URL(barLink('https://wobillig.ch/?drink=softdrink&softdrinkSelection=cola', 'node/1', 'softdrink', '300-330'));
    expect(softdrinkLink.searchParams.get('softdrinkSelection')).toBe('cola');
  });
});
