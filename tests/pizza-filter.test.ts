import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bestOffer, cheapPriceLimit, filterBars, pizzaVarieties, type Bar, type Offer } from '../src/data';
import { filtersFromSearch, writeFilters } from '../src/filters';
import { cityAverage } from '../src/coverage';
import { barLink } from '../src/sharing';
import { pizzaNameKey } from '../src/pizza-selection';

const margherita: Offer = { name: 'Margherita', pizzaType: 'margherita', priceChf: 16, volumeMl: null,
  alcoholFree: true, confidence: 'reviewed', observedAt: '2026-10-19', sourceUrl: 'https://example.org/menu', evidence: '' };
const venue: Bar = { id: '1', name: 'Restaurant', type: 'restaurant', lat: 47, lon: 8, address: '', postcode: '',
  website: null, openingHours: null, outdoor: false, scrapeStatus: 'prices_found', checkedAt: null,
  offers: [margherita], pizzaMenu: [
    { ...margherita, pizzaType: 'other', name: 'Prosciutto', priceChf: 21, ingredients: 'Tomaten, Mozzarella, Schinken' },
    { ...margherita, pizzaType: 'other', name: 'Quattro Stagioni', priceChf: 24, ingredients: 'Prosciutto cotto, Pilze, Oliven' },
  ] };
const defaults = filtersFromSearch(new URLSearchParams('drink=pizza'));

describe('cheap pizza selections', () => {
  const bars = [18, 20, 22, 24, 26].map((priceChf, index) => ({
    ...venue, id: String(index), pizzaMenu: [{
      ...venue.pizzaMenu![0], name: 'Formaggi della casa', priceChf,
      ingredients: 'Mozzarella, Gorgonzola, Taleggio, Parmesan',
    }],
  }));
  it('uses the selected group prices independently of cheaper Margheritas and the budget', () => {
    const filters = { ...defaults, pizzaSelection: 'group:quattro_formaggi' as const, max: 10 };
    expect(cheapPriceLimit(bars, defaults)).toBe(18);
    const max = cheapPriceLimit(bars, filters)!;
    expect(max).toBe(22);
    expect(filterBars(bars, { ...filters, max })).toEqual(bars.slice(0, 3));
    expect(cheapPriceLimit(bars, { ...filters, pizzaSelection: 'all' })).toBe(16);
  });
  it('adapts to ingredient searches and legacy exact-name selections', () => {
    expect(cheapPriceLimit(bars, { ...defaults, pizzaQuery: 'gorgonzola' })).toBe(22);
    expect(cheapPriceLimit(bars, { ...defaults, pizzaSelection: 'name:formaggi della casa' })).toBe(22);
    expect(cheapPriceLimit(bars, { ...defaults, pizzaQuery: 'ananas' })).toBeUndefined();
  });
  it('keeps a matching offer when a small sample costs more than CHF 18', () => {
    expect(cheapPriceLimit([bars[4]], { ...defaults, pizzaSelection: 'group:quattro_formaggi' })).toBe(26);
  });
});

describe('pizza name and ingredient filters', () => {
  it('compares Da Raffaele Verdure with mozzarella separately from Vegana', () => {
    const data = JSON.parse(readFileSync('public/data/pizza.json', 'utf8'));
    const raffaele = data.bars.find((bar: Bar) => bar.name === 'Da Raffaele') as Bar;
    const vegetarian = { ...defaults, pizzaSelection: 'group:vegetariana' as const };
    const vegan = { ...defaults, pizzaSelection: 'group:vegan' as const };
    expect(bestOffer(raffaele, vegetarian)).toMatchObject({ name: 'Verdure', priceChf: 23.5 });
    expect(bestOffer(raffaele, vegan)).toMatchObject({ name: 'Vegana', priceChf: 21.5 });
    expect(filterBars([raffaele], { ...vegetarian, max: 21.7 })).toEqual([]);
    expect(filterBars([raffaele], { ...vegan, max: 21.7 })).toEqual([raffaele]);
    expect(pizzaVarieties([raffaele])).toContainEqual({ value: 'group:vegan', label: 'Vegan' });
    const params = new URLSearchParams();
    writeFilters(params, vegan, false);
    expect(filtersFromSearch(params)).toEqual(vegan);
    const link = new URL(barLink(`https://wobillig.ch/?${params}`, raffaele.id, 'pizza', 'all'));
    expect(filtersFromSearch(link.searchParams).pizzaSelection).toBe('group:vegan');
  });
  it('keeps Margherita as default and compares the actual matching pizza prices', () => {
    expect(bestOffer(venue, defaults)?.priceChf).toBe(16);
    const filters = { ...defaults, pizzaSelection: 'all' as const, pizzaQuery: 'prosciutto' };
    expect(bestOffer(venue, filters)?.priceChf).toBe(21);
    expect(filterBars([venue], { ...filters, max: 20 })).toEqual([]);
    expect(cityAverage([venue], filters)).toEqual({ price: 21, count: 1 });
    expect(bestOffer(venue, { ...filters, pizzaQuery: 'proscuito' })?.priceChf).toBe(21);
    expect(bestOffer(venue, { ...filters, pizzaQuery: 'PROSCIUTTO PILZE' })?.name).toBe('Quattro Stagioni');
  });
  it('does not show unrelated restaurants or infer unavailable ingredients', () => {
    const filters = { ...defaults, pizzaQuery: 'Prosciutto', unknown: true };
    expect(filterBars([{ ...venue, pizzaMenu: [] }, venue], filters)).toEqual([venue]);
    expect(bestOffer(venue, { ...filters, pizzaQuery: 'Basilikum' })).toBeUndefined();
    expect(filterBars([venue], { ...defaults, drink: 'coffee', pizzaQuery: 'Prosciutto' })).toEqual([venue]);
  });
  it('supports menus without Margherita and all-pizza comparisons', () => {
    const menuOnly = { ...venue, offers: [] };
    expect(bestOffer(menuOnly, defaults)).toBeUndefined();
    expect(bestOffer(menuOnly, { ...defaults, pizzaSelection: 'all' })?.priceChf).toBe(21);
    expect(bestOffer(menuOnly, { ...defaults, pizzaQuery: 'schinken' })?.name).toBe('Prosciutto');
  });
  it('preserves pizza selection in URL filters and shared venue links', () => {
    const filters = { ...defaults, pizzaSelection: 'all' as const, pizzaQuery: 'Prosciutto & Funghi' };
    const params = new URLSearchParams();
    writeFilters(params, filters, false);
    expect(filtersFromSearch(params)).toEqual(filters);
    const link = new URL(barLink(`https://wobillig.ch/?${params}`, venue.id, 'pizza', 'all'));
    expect(link.searchParams.get('pizzaQuery')).toBe(filters.pizzaQuery);
    expect(link.searchParams.get('pizzaSelection')).toBe('all');
    expect(new URL(barLink(link.href, venue.id, 'coffee', 'all')).searchParams.has('pizzaQuery')).toBe(false);
  });
  it('lists ingredient groups once and still supports old exact-name links', () => {
    expect(pizzaNameKey('4 Formaggi')).toBe(pizzaNameKey('Pizza 4 Formaggi'));
    const duplicate = { ...venue, pizzaMenu: [{ ...venue.pizzaMenu![0], name: '019 Pizza PROSCIUTTO' }] };
    expect(pizzaVarieties([venue, duplicate])).toEqual([
      { value: 'group:prosciutto', label: 'Prosciutto' },
      { value: 'group:quattro_stagioni', label: 'Quattro Stagioni' },
    ]);
    const filters = { ...defaults, pizzaSelection: 'name:prosciutto' as const };
    expect(bestOffer(duplicate, filters)?.priceChf).toBe(21);
    const onlyIngredients = { ...venue, pizzaMenu: [venue.pizzaMenu![1]] };
    expect(filterBars([onlyIngredients, venue], filters)).toEqual([venue]);
    expect(cityAverage([onlyIngredients, venue], filters)).toEqual({ price: 21, count: 1 });
    expect(filterBars([venue], { ...filters, max: 20 })).toEqual([]);
  });
  it('compares matching ingredients across house names and excludes unrelated venues', () => {
    const house = { ...venue, id: 'house', pizzaMenu: [
      { ...venue.pizzaMenu![0], name: 'Della casa', priceChf: 19 },
    ] };
    const filters = { ...defaults, pizzaSelection: 'group:prosciutto' as const, unknown: true };
    expect(bestOffer(house, filters)?.priceChf).toBe(19);
    expect(filterBars([{ ...venue, pizzaMenu: [] }, house, venue], filters)).toEqual([house, venue]);
    expect(cityAverage([house, venue], filters)).toEqual({ price: 20, count: 2 });
    expect(filterBars([house, venue], { ...filters, max: 20 })).toEqual([house]);
  });
  it('restores ingredient groups in URL filters and shared links', () => {
    const filters = { ...defaults, pizzaSelection: 'group:vegetariana' as const };
    const params = new URLSearchParams();
    writeFilters(params, filters, false);
    expect(filtersFromSearch(params)).toEqual(filters);
    const link = new URL(barLink(`https://wobillig.ch/?${params}`, venue.id, 'pizza', 'all'));
    expect(filtersFromSearch(link.searchParams).pizzaSelection).toBe('group:vegetariana');
    expect(filtersFromSearch(new URLSearchParams('pizzaSelection=group:invalid')).pizzaSelection).toBeUndefined();
  });
  it('requires three distinct venues for Funghi and ignores invalid prices', () => {
    const funghi = { ...venue.pizzaMenu![0], name: 'Bosco', ingredients: 'Tomaten, Mozzarella, Pilze' };
    const bars = ['1', '2', '3'].map(id => ({ ...venue, id, offers: [], pizzaMenu: [funghi, funghi] }));
    expect(pizzaVarieties(bars.slice(0, 2))).toEqual([]);
    expect(pizzaVarieties(bars)).toEqual([{ value: 'group:funghi', label: 'Funghi' }]);
    expect(pizzaVarieties([{ ...venue, offers: [], pizzaMenu: [{ ...funghi, priceChf: NaN }] }])).toEqual([]);
  });
  it('restores named varieties after reload and in shared links', () => {
    const filters = { ...defaults, pizzaSelection: 'name:quattro stagioni' as const };
    const params = new URLSearchParams();
    writeFilters(params, filters, false);
    expect(filtersFromSearch(params)).toEqual(filters);
    const link = new URL(barLink(`https://wobillig.ch/?${params}`, venue.id, 'pizza', 'all'));
    expect(filtersFromSearch(link.searchParams).pizzaSelection).toBe(filters.pizzaSelection);
    expect(filtersFromSearch(new URLSearchParams('pizzaSelection=name:')).pizzaSelection).toBeUndefined();
  });
});
