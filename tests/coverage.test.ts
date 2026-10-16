import { expect, it } from 'vitest';
import { cityAverage, coverageLabel, missingPriceLabel } from '../src/coverage';
import type { Bar, Filters, Offer } from '../src/data';

const f: Filters = { drink: 'beer', query: '', volume: '500', max: 15, type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
const offer: Offer = { name: 'Lager', volumeMl: 500, priceChf: 8, alcoholFree: false, sourceUrl: 'https://example.org/menu', observedAt: '2026-10-15', confidence: 'reviewed', evidence: '' };
const bar = (offers: Offer[]): Bar => ({ id: '1', name: 'Bar', lat: 47, lon: 8, type: 'bar', address: '', postcode: '', website: null, openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'no_prices', offers });

it('separates missing data from prices outside the selected size or serving filter', () => {
  const small = bar([{ ...offer, volumeMl: 300 }]);
  const coffee = bar([{ ...offer, volumeMl: null, coffeeType: 'espresso' }]);
  expect(missingPriceLabel(small, f)).toBe('Kein passender Preis');
  expect(missingPriceLabel(coffee, f)).toBe('Noch nicht erfasst');
  expect(missingPriceLabel(bar([]), f)).toBe('Noch nicht erfasst');
  expect(coverageLabel([small, coffee, bar([]), bar([offer])], f)).toBe('4 Lokale · 2 mit Bierpreis · 1 passend zum Filter');
  expect(coverageLabel([coffee], { ...f, drink: 'coffee', coffeeType: 'creme' })).toBe('1 Lokale · 1 mit Kaffeepreis · 0 passend zum Filter');
});

it('does not count old mixed-drink offers as beer coverage', () => {
  const mixed = bar([{ ...offer, name: 'Panash', beerType: 'draft' }]);
  expect(missingPriceLabel(mixed, f)).toBe('Noch nicht erfasst');
  expect(coverageLabel([mixed], f)).toBe('1 Lokale · 0 mit Bierpreis · 0 passend zum Filter');
});

it('averages one cheapest matching price per venue, independently of list filters', () => {
  const coffee = { ...offer, coffeeType: 'cappuccino', volumeMl: null, priceChf: 5 };
  const venues = [
    bar([coffee, { ...coffee, priceChf: 8 }]),
    { ...bar([{ ...coffee, priceChf: 6 }]), id: '2' },
    { ...bar([]), id: '3' },
    { ...bar([{ ...coffee, priceChf: 1 }]), id: '4', type: 'fast_food' },
    { ...bar([{ ...coffee, coffeeType: 'espresso', priceChf: 2 }]), id: '5' },
    { ...bar([{ ...coffee, priceChf: 3, photoSource: { kind: 'google_maps_photo' as const, date: '2020-01-01', dateEvidence: '', dateCheckedAt: '', validUntil: '2020-07-01' } }]), id: '6' },
  ];
  expect(cityAverage(venues, { ...f, drink: 'coffee', coffeeType: 'cappuccino', max: 1, query: 'no match', outdoor: true, type: 'cafe' }))
    .toEqual({ price: 5.5, count: 2 });
});

it('uses the chosen beer size, serving format and price comparison', () => {
  const venues = [bar([{ ...offer, volumeMl: 300, priceChf: 3, beerType: 'draft' }, { ...offer, priceChf: 8, beerType: 'bottle' }])];
  expect(cityAverage(venues, { ...f, volume: '300', beerType: 'draft' })).toEqual({ price: 3, count: 1 });
  expect(cityAverage(venues, { ...f, volume: '300', beerType: 'draft', mode: 'half' })).toEqual({ price: 5, count: 1 });
  expect(cityAverage(venues, { ...f, volume: '300', beerType: 'bottle' })).toBeUndefined();
  expect(cityAverage([], f)).toBeUndefined();
  expect(cityAverage([bar([])], f)).toBeUndefined();
});

it('also computes a city benchmark for Margherita', () => {
  expect(cityAverage([bar([{ ...offer, pizzaType: 'margherita', volumeMl: null, priceChf: 19 }])], { ...f, drink: 'pizza' }))
    .toEqual({ price: 19, count: 1 });
});
