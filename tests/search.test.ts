import { expect, it } from 'vitest';
import { matchesSearch, normalizeSearch, searchSuggestions } from '../src/search';
import { filterBars, type Bar, type Filters } from '../src/data';

const bar = (id: string, name: string, address = '', postcode = '8004'): Bar => ({
  id, name, address, postcode, lat: 47.37, lon: 8.52, type: 'bar', offers: [],
  website: null, openingHours: null, outdoor: false, scrapeStatus: 'no_prices', checkedAt: null,
});

it('matches names, addresses and postcodes regardless of accents, punctuation, spacing or word order', () => {
  const venue = bar('1', 'Café Mühli', 'Zürichstrasse 10');
  expect(matchesSearch(venue, ' muhli  cafe ')).toBe(true);
  expect(matchesSearch(venue, '10 zurichstrasse')).toBe(true);
  expect(matchesSearch(venue, '8004 café')).toBe(true);
  expect(normalizeSearch('Straße · Café')).toBe('strasse cafe');
  expect(matchesSearch(venue, 'bern')).toBe(false);
});

it('prioritizes exact names, then name prefixes, then partial names over address matches', () => {
  const venues = [bar('4', 'Bar', 'Piccolo 12'), bar('3', 'Il Piccolo'), bar('2', 'Piccolo Bar'), bar('1', 'Piccolo')];
  expect(searchSuggestions(venues, 'piccolo').map(b => b.id)).toEqual(['1', '2', '3', '4']);
  expect(searchSuggestions(venues, 'piccolo', 2).map(b => b.id)).toEqual(['1', '2']);
  expect(venues[0].id).toBe('4');
  expect(searchSuggestions(venues, '')).toEqual([]);
  expect(searchSuggestions(venues, 'unknown')).toEqual([]);
});

it('finds unpriced venues and uses the same text matching for the list and suggestions', () => {
  const venues = [bar('1', 'Piccolo'), bar('2', 'Café Mühli', 'Zürichstrasse 10')];
  const filters: Filters = { drink: 'beer', query: 'piccolo', max: 15, volume: '300-330', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
  expect(filterBars(venues, filters)).toEqual(searchSuggestions(venues, filters.query));
  expect(searchSuggestions(venues, 'piccolo')[0].offers).toEqual([]);
  expect(filterBars(venues, { ...filters, query: 'muhli 8004' })).toEqual([venues[1]]);
  expect(filterBars(venues, { ...filters, unknown: false })).toEqual([]);
  expect(searchSuggestions(venues, 'piccolo')).toEqual([venues[0]]);
});
