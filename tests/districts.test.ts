import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { containsLocation, createDistrictLookup, districtFromSearch, type District, type Districts } from '../src/districts';
import { cities, cityLink } from '../src/cities';
import { cityAverage } from '../src/coverage';
import type { Dataset, Filters } from '../src/data';

const load = (path: string) => JSON.parse(readFileSync(new URL(`../public/data/${path}`, import.meta.url), 'utf8')) as Districts;
const districts = load('districts.json');

it('uses real Lausanne and Geneva boundaries and preserves Lausanne’s non-contiguous official IDs', () => {
  const lausanne = load('lausanne/districts.json'), geneva = load('geneva/districts.json');
  expect(lausanne.features.map(d => d.properties.number)).toEqual([...Array.from({ length: 17 }, (_, i) => i + 1), 90]);
  expect(geneva.features).toHaveLength(8);
  const inLausanne = createDistrictLookup(lausanne), inGeneva = createDistrictLookup(geneva);
  expect(inLausanne({ lat: 46.5226, lon: 6.6351 })).toBe(1); // Cathedral, Centre
  expect(inGeneva({ lat: 46.201, lon: 6.149 })).toBe(4); // Old town, Eaux-Vives Cité
  expect(inLausanne({ lat: 46.201, lon: 6.149 })).toBeUndefined();
  expect(inGeneva({ lat: 46.5226, lon: 6.6351 })).toBeUndefined();
  expect(districtFromSearch(new URLSearchParams('quartierLausanne=90'), 'lausanne')).toEqual({ enabled: true, selected: 90 });
  expect(districtFromSearch(new URLSearchParams('quartierLausanne=18'), 'lausanne')).toEqual({ enabled: false, selected: undefined });
  expect(cityLink('geneva', '?quartiers=1&quartierLausanne=90&drink=beer', '/', 'en')).toBe('/en/geneve?drink=beer');
});

it('uses the seven Winterthur Stadtkreise without Zürich’s Kreise from the shared cantonal layer', () => {
  const winterthur = load('winterthur/districts.json');
  expect(winterthur.features.map(d => d.properties.name)).toEqual(['Winterthur-Stadt', 'Oberwinterthur', 'Seen', 'Töss', 'Veltheim', 'Wülflingen', 'Mattenbach']);
  const lookup = createDistrictLookup(winterthur);
  expect(lookup({ lat: 47.5003, lon: 8.7237 })).toBe(1); // Hauptbahnhof
  expect(lookup({ lat: 47.5096, lon: 8.7614 })).toBe(2); // Bahnhof Oberwinterthur
  expect(lookup({ lat: 47.4885, lon: 8.7105 })).toBe(4); // Töss
  expect(lookup({ lat: 47.5101, lon: 8.6878 })).toBe(6); // Wülflingen
  expect(lookup({ lat: 47.3717, lon: 8.5422 })).toBeUndefined();
  expect(createDistrictLookup(districts)({ lat: 47.5003, lon: 8.7237 })).toBeUndefined();
  expect(districtFromSearch(new URLSearchParams('stadtkreis=7'), 'winterthur')).toEqual({ enabled: true, selected: 7 });
  expect(districtFromSearch(new URLSearchParams('stadtkreis=8'), 'winterthur')).toEqual({ enabled: false, selected: undefined });
  expect(districtFromSearch(new URLSearchParams('kreis=5'), 'winterthur')).toEqual({ enabled: false, selected: undefined });
  expect(cityLink('winterthur', '?kreise=1&kreis=5&drink=beer')).toBe('/winterthur?drink=beer');
  expect(cityLink('zurich', '?stadtkreise=1&stadtkreis=5&drink=beer')).toBe('/?drink=beer');
});

it('assigns known Zürich locations to official boundaries and excludes other cities', () => {
  expect(districts.features.map(d => d.properties.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const lookup = createDistrictLookup(districts);
  expect(lookup({ lat: 47.3717, lon: 8.5422 })).toBe(1); // Grossmünster
  expect(lookup({ lat: 47.3851076, lon: 8.5314772 })).toBe(5); // Café Lang, Limmatplatz 7
  expect(lookup({ lat: 47.4105, lon: 8.5442 })).toBe(11); // Bahnhof Oerlikon
  expect(lookup({ lat: 46.948, lon: 7.447 })).toBeUndefined();
  expect(lookup({ lat: 47.558, lon: 7.589 })).toBeUndefined();
});

it('uses the named Basel Wohnviertel and Bern Stadtteile without neighbouring municipalities', () => {
  const basel = load('basel/districts.json'), bern = load('bern/districts.json');
  expect(basel.features.map(d => d.properties.number)).toEqual(Array.from({ length: cities.basel.districts.count }, (_, i) => i + 1));
  expect(bern.features.map(d => d.properties.name)).toEqual(['Innere Stadt', 'Länggasse-Felsenau', 'Mattenhof-Weissenbühl', 'Kirchenfeld-Schosshalde', 'Breitenrain-Lorraine', 'Bümpliz-Oberbottigen']);
  const inBasel = createDistrictLookup(basel), inBern = createDistrictLookup(bern);
  expect(inBasel({ lat: 47.5565, lon: 7.5923 })).toBe(1); // Münster, Altstadt Grossbasel
  expect(inBasel({ lat: 47.5628, lon: 7.5944 })).toBe(13); // Claraplatz
  expect(inBasel({ lat: 47.5636, lon: 7.6003 })).toBe(16); // Messeplatz, Rosental
  expect(inBasel({ lat: 47.5849, lon: 7.6513 })).toBeUndefined(); // Riehen
  expect(inBern({ lat: 46.94797, lon: 7.44784 })).toBe(1); // Zytglogge
  expect(inBern({ lat: 46.9632, lon: 7.4646 })).toBe(5); // Wankdorf
  expect(inBern({ lat: 46.9445, lon: 7.388 })).toBe(6); // Bümpliz
  expect(inBern({ lat: 47.3717, lon: 8.5422 })).toBeUndefined();
  for (const city of ['basel', 'bern'] as const) {
    const lookup = createDistrictLookup(city === 'basel' ? basel : bern);
    const coffee = JSON.parse(readFileSync(new URL(`../public/data/${city}/coffee.json`, import.meta.url), 'utf8')) as Dataset;
    expect(coffee.bars.filter(b => lookup(b) === undefined)).toEqual([]);
  }
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

it('restores valid district links per city and clears them when switching cities', () => {
  expect(districtFromSearch(new URLSearchParams('kreis=5'), 'zurich')).toEqual({ enabled: true, selected: 5 });
  expect(districtFromSearch(new URLSearchParams('kreise=1'), 'zurich')).toEqual({ enabled: true, selected: undefined });
  for (const value of ['0', '13', '-1', '1.5', 'nope', '']) {
    expect(districtFromSearch(new URLSearchParams(`kreis=${value}`), 'zurich')).toEqual({ enabled: false, selected: undefined });
  }
  expect(districtFromSearch(new URLSearchParams('quartier=19'), 'basel')).toEqual({ enabled: true, selected: 19 });
  expect(districtFromSearch(new URLSearchParams('quartier=20'), 'basel')).toEqual({ enabled: false, selected: undefined });
  expect(districtFromSearch(new URLSearchParams('stadtteile=1'), 'bern')).toEqual({ enabled: true, selected: undefined });
  expect(districtFromSearch(new URLSearchParams('stadtteil=7'), 'bern')).toEqual({ enabled: false, selected: undefined });
  for (const city of ['bern', 'basel'] as const) {
    expect(districtFromSearch(new URLSearchParams('kreise=1&kreis=5'), city)).toEqual({ enabled: false, selected: undefined });
    expect(cityLink(city, '?drink=coffee&kreise=1&kreis=5')).toBe(`/${city}?drink=coffee`);
  }
  expect(cityLink('bern', '?quartiere=1&quartier=4&stadtteile=1&stadtteil=2')).toBe('/bern?stadtteile=1&stadtteil=2');
  expect(cityLink('zurich', '?kreise=1&kreis=4&stadtteile=1&stadtteil=2')).toBe('/?kreise=1&kreis=4');
});

it('computes the Kreis average only from its matching venues without a budget or search bias', () => {
  const coffee = JSON.parse(readFileSync(new URL('../public/data/coffee.json', import.meta.url), 'utf8')) as Dataset;
  const lookup = createDistrictLookup(districts);
  const bars = coffee.bars.filter(b => lookup(b) === 5);
  const f: Filters = { drink: 'coffee', coffeeType: 'cappuccino', query: '', max: 15, volume: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
  const average = cityAverage(bars, f);
  expect(average?.count).toBeGreaterThan(0);
  expect(average?.count).toBeLessThan(cityAverage(coffee.bars, f)!.count);
  expect(cityAverage(bars, { ...f, query: 'no results', max: 1, outdoor: true })).toEqual(average);
  // The venue type is part of the benchmark, so the Kreis average changes with it.
  expect(cityAverage(bars, { ...f, type: 'bar' })).not.toEqual(average);
  expect(cityAverage([], f)).toBeUndefined();
});
