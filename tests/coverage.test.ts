import { expect, it } from 'vitest';
import { coverageLabel, missingPriceLabel } from '../src/coverage';
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
