import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { containsLocation, createDistrictLookup, districtFromSearch, type District, type Districts } from '../src/districts';
import { cityLink } from '../src/cities';
import { cityAverage } from '../src/coverage';
import type { Dataset, Filters } from '../src/data';

const districts = JSON.parse(readFileSync(new URL('../public/data/districts.json', import.meta.url), 'utf8')) as Districts;

it('assigns known Zürich locations to official boundaries and excludes other cities', () => {
  expect(districts.features.map(d => d.properties.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const lookup = createDistrictLookup(districts);
  expect(lookup({ lat: 47.3717, lon: 8.5422 })).toBe(1); // Grossmünster
  expect(lookup({ lat: 47.3851076, lon: 8.5314772 })).toBe(5); // Café Lang, Limmatplatz 7
  expect(lookup({ lat: 47.4105, lon: 8.5442 })).toBe(11); // Bahnhof Oerlikon
  expect(lookup({ lat: 46.948, lon: 7.447 })).toBeUndefined();
  expect(lookup({ lat: 47.558, lon: 7.589 })).toBeUndefined();
});

it('handles holes, boundary points and disconnected polygons', () => {
  const district: District = { type: 'Feature', properties: { number: 1 }, geometry: { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
    [[[6, 6], [7, 6], [7, 7], [6, 7], [6, 6]]],
  ] } };
  expect(containsLocation(district, { lat: 3, lon: 3 })).toBe(true);
  expect(containsLocation(district, { lat: 1.5, lon: 1.5 })).toBe(false);
  expect(containsLocation(district, { lat: 0, lon: 3 })).toBe(true);
  expect(containsLocation(district, { lat: 6.5, lon: 6.5 })).toBe(true);
  expect(containsLocation(district, { lat: 5, lon: 5 })).toBe(false);
});

it('restores valid district links only for Zürich and clears them when switching cities', () => {
  expect(districtFromSearch(new URLSearchParams('kreis=5'), 'zurich')).toEqual({ enabled: true, selected: 5 });
  expect(districtFromSearch(new URLSearchParams('kreise=1'), 'zurich')).toEqual({ enabled: true, selected: undefined });
  for (const value of ['0', '13', '-1', '1.5', 'nope', '']) {
    expect(districtFromSearch(new URLSearchParams(`kreis=${value}`), 'zurich')).toEqual({ enabled: false, selected: undefined });
  }
  for (const city of ['bern', 'basel'] as const) {
    expect(districtFromSearch(new URLSearchParams('kreise=1&kreis=5'), city)).toEqual({ enabled: false, selected: undefined });
    expect(cityLink(city, '?drink=coffee&kreise=1&kreis=5')).toBe(`/${city}?drink=coffee`);
  }
});

it('computes the Kreis average only from its matching venues without a budget or search bias', () => {
  const coffee = JSON.parse(readFileSync(new URL('../public/data/coffee.json', import.meta.url), 'utf8')) as Dataset;
  const lookup = createDistrictLookup(districts);
  const bars = coffee.bars.filter(b => lookup(b) === 5);
  const f: Filters = { drink: 'coffee', coffeeType: 'cappuccino', query: '', max: 15, volume: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
  const average = cityAverage(bars, f);
  expect(average?.count).toBeGreaterThan(0);
  expect(average?.count).toBeLessThan(cityAverage(coffee.bars, f)!.count);
  expect(cityAverage(bars, { ...f, query: 'no results', max: 1, outdoor: true, type: 'bar' })).toEqual(average);
  expect(cityAverage([], f)).toBeUndefined();
});
