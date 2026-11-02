import { describe, expect, it } from 'vitest';
import { contributionVenues, parseContribution } from '../src/smart-contribution';
import type { Bar } from '../src/data';

const parse = (text: string, venue?: Bar) => parseContribution(text, 'zurich', venue);
const venue = (id: string, name: string, address = 'Bahnhofstrasse 1') => ({ id, name, address, postcode: '8001' } as Bar);

describe('smart contributions', () => {
  it('reads the original example including misspellings and Swiss prices', () => {
    expect(parse('food court am hbn pizza margeritha für 5.-')).toMatchObject({
      fields: { drink: 'pizza', name: 'Pizza Margherita', priceChf: 5 }, venueQuery: 'food court hbn', notes: [],
    });
    expect(parse('Cappuccino bei Café Test für CHF 4,50').fields).toMatchObject({ drink: 'coffee', coffeeType: 'cappuccino', priceChf: 4.5 });
    expect(parse('Espresso bei Test für 3.50').fields.priceChf).toBe(3.5);
    expect(parse('Espresso bei Test 3.–').fields.priceChf).toBe(3);
  });
  it.each(['ab 5 CHF', 'unter 5 CHF', 'ca. 5 CHF', '5–7 CHF', '-5 CHF', '5 CHF statt 8 CHF', '5 CHF oder 6 CHF', '5.123 CHF', '500 CHF', 'Aktion 5 CHF', '5 CHF nur heute'])(
    'does not turn %s into an observed unit price', price => {
      expect(parse(`Pizza Margherita bei Test ${price}`).fields.priceChf).toBeUndefined();
    });
  it('does not turn a slice or a different pizza into a whole Margherita', () => {
    for (const pizza of ['Stück Pizza Margherita', 'Pizza Prosciutto', 'vegane Margherita', 'Pizza', 'Kinderpizza Margherita']) {
      const result = parse(`${pizza} bei Test 5 CHF`);
      expect(result.fields.priceChf, pizza).toBeUndefined();
      expect(result.fields.drink, pizza).toBeUndefined();
      expect(result.notes).toContain('pizza');
    }
  });
  it('leaves missing types and amounts open instead of using search defaults', () => {
    expect(parse('Kaffee bei Test CHF 4').fields.coffeeType).toBeUndefined();
    expect(parse('Bier bei Test CHF 5').fields).toMatchObject({ drink: 'beer', beerType: 'unknown' });
    expect(parse('Bier bei Test CHF 5').fields.volumeMl).toBeUndefined();
    expect(parse('Stange bei Test CHF 5').fields).toMatchObject({ serving: 'stange', volumeMl: null });
    expect(parse('Cola 3 dl bei Test für 4.50').fields).toMatchObject({ drink: 'softdrink', volumeMl: 300, priceChf: 4.5 });
    expect(parse('Bier für 5 dl bei Test').fields.priceChf).toBeUndefined();
  });
  it('ignores product words in the chosen venue name', () => {
    expect(parse('Espresso Bar Stange für 5 CHF', venue('1', 'Espresso Bar')).fields.drink).toBe('beer');
  });
  it('does not turn multiple products or portions into a single product price', () => {
    expect(parse('Espresso und Cappuccino bei Test für 5 CHF').fields).toEqual({});
    expect(parse('2 Pizza Margherita bei Test für 10 CHF').fields.priceChf).toBeUndefined();
    expect(parse('zwei Cappuccini bei Test für 8 CHF').notes).toContain('multiple');
  });
  it('offers matching venues without choosing a branch or inventing one', () => {
    const a = venue('1', 'Food Court'), b = venue('2', 'Food Court', 'Bahnhofstrasse 2'), c = venue('3', 'Anderes Café');
    expect(contributionVenues([a, b, c], 'Food Court am hbn Pizza Margherita 5 CHF', 'food court hbn')).toEqual([a, b]);
    expect(contributionVenues([a, b, c], 'Unbekanntes Lokal', 'Unbekanntes Lokal')).toEqual([]);
    expect(contributionVenues([a, b, c], 'Bahnhofstrasse 2', 'Bahnhofstrasse 2')).toEqual([b]);
  });
});
