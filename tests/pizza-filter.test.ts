import { describe, expect, it } from 'vitest';
import { bestOffer, filterBars, pizzaVarieties, type Bar, type Offer } from '../src/data';
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

describe('pizza name and ingredient filters', () => {
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
  it('lists recorded varieties once and matches the named pizza rather than its ingredients', () => {
    expect(pizzaNameKey('4 Formaggi')).toBe(pizzaNameKey('Pizza 4 Formaggi'));
    const duplicate = { ...venue, pizzaMenu: [{ ...venue.pizzaMenu![0], name: '019 Pizza PROSCIUTTO' }] };
    expect(pizzaVarieties([venue, duplicate])).toEqual([
      { value: 'name:prosciutto', label: 'Prosciutto' },
      { value: 'name:quattro stagioni', label: 'Quattro Stagioni' },
    ]);
    const filters = { ...defaults, pizzaSelection: 'name:prosciutto' as const };
    expect(bestOffer(duplicate, filters)?.priceChf).toBe(21);
    const onlyIngredients = { ...venue, pizzaMenu: [venue.pizzaMenu![1]] };
    expect(filterBars([onlyIngredients, venue], filters)).toEqual([venue]);
    expect(cityAverage([onlyIngredients, venue], filters)).toEqual({ price: 21, count: 1 });
    expect(filterBars([venue], { ...filters, max: 20 })).toEqual([]);
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
