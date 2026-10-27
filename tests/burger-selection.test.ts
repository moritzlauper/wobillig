import { describe, expect, it } from 'vitest';
import { parseBurgerSelection, burgerSelectionLabels } from '../src/burger-selection';
import { matchesBurger, matchingOffers, type Bar, type Filters, type Offer } from '../src/data';

const observedAt = '2026-10-27T12:00:00.000Z';
const offer = (values: Partial<Offer> & Pick<Offer, 'name' | 'priceChf'>): Offer => ({
  volumeMl: null, sourceUrl: 'https://burger.example/menu', observedAt, confidence: 'ai', evidence: values.name,
  alcoholFree: true, burgerType: 'burger', burgerDiet: 'standard', ...values,
});
const venue = (offers: Offer[]): Bar => ({
  id: 'node/1', name: 'Burgerhaus', lat: 47.37, lon: 8.54, type: 'restaurant', address: 'Bahnhofstrasse 1', postcode: '8001',
  website: 'https://burger.example/', openingHours: null, outdoor: false, offers, scrapeStatus: 'prices_found', checkedAt: observedAt,
});
const filters = (values: Partial<Filters> = {}): Filters => ({
  drink: 'burger', query: '', max: Infinity, volume: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price', ...values,
});
const classic = offer({ name: 'Classic Burger', priceChf: 22 });
const veggie = offer({ name: 'Veggie Burger', priceChf: 19, burgerDiet: 'vegetarian' });
const vegan = offer({ name: 'Vegan Burger', priceChf: 21, burgerDiet: 'vegan' });
const glutenFree = offer({ name: 'Classic Burger glutenfrei', priceChf: 24, glutenFree: true });

describe('burger selection', () => {
  it('parses only known choices', () => {
    expect(parseBurgerSelection('vegan')).toBe('vegan');
    expect(parseBurgerSelection('glutenfree')).toBe('glutenfree');
    expect(parseBurgerSelection('toString')).toBeUndefined();
    expect(parseBurgerSelection('pizza')).toBeUndefined();
    expect(parseBurgerSelection(null)).toBeUndefined();
    expect(Object.keys(burgerSelectionLabels)).toEqual(['all', 'vegetarian', 'vegan', 'glutenfree']);
  });

  it('shows every burger by default and never a pizza', () => {
    const pizza = offer({ name: 'Margherita', priceChf: 20, burgerType: undefined, pizzaType: 'margherita' });
    expect(matchesBurger(classic, filters())).toBe(true);
    expect(matchesBurger(pizza, filters())).toBe(false);
  });

  it('keeps vegan burgers in the vegetarian choice', () => {
    const f = filters({ burgerSelection: 'vegetarian' });
    expect([classic, veggie, vegan].filter(o => matchesBurger(o, f)).map(o => o.name)).toEqual(['Veggie Burger', 'Vegan Burger']);
    expect([classic, veggie, vegan].filter(o => matchesBurger(o, filters({ burgerSelection: 'vegan' }))).map(o => o.name)).toEqual(['Vegan Burger']);
  });

  it('matches gluten-free burgers by the scraped flag or the sourced name', () => {
    const named = offer({ name: 'Glutenfreier Burger', priceChf: 23 });
    const f = filters({ burgerSelection: 'glutenfree' });
    expect([classic, glutenFree, named].filter(o => matchesBurger(o, f)).map(o => o.name)).toEqual(['Classic Burger glutenfrei', 'Glutenfreier Burger']);
  });

  it('lists the cheapest matching burger per venue', () => {
    const bar = venue([classic, veggie, vegan, glutenFree]);
    expect(matchingOffers(bar, filters())[0].name).toBe('Veggie Burger');
    expect(matchingOffers(bar, filters({ burgerSelection: 'vegan' })).map(o => o.name)).toEqual(['Vegan Burger']);
    expect(matchingOffers(bar, filters({ burgerSelection: 'glutenfree' }))[0].priceChf).toBe(24);
  });
});
