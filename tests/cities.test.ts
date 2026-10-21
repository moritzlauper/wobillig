import { describe, expect, it } from 'vitest';
import { cities, cityFromPath, cityLink, cityStoragePath, defaultCityLocale } from '../src/cities';
import { barLink } from '../src/sharing';
import { localeFromPath } from '../src/i18n';

describe('city navigation and storage isolation', () => {
  it('resolves direct and trailing-slash URLs, including a deployment base', () => {
    expect(cityFromPath('/')).toBe('zurich');
    expect(cityFromPath('/bern')).toBe('bern');
    expect(cityFromPath('/basel/')).toBe('basel');
    expect(cityFromPath('/wobillig/bern/', '/wobillig/')).toBe('bern');
    expect(cityFromPath('/bern-other')).toBe('zurich');
    expect(cityFromPath('/en')).toBe('zurich');
    expect(cityFromPath('/en/basel/')).toBe('basel');
    expect(cityFromPath('/wobillig/en/bern', '/wobillig/')).toBe('bern');
    expect(cityFromPath('/en/lausanne')).toBe('lausanne');
    expect(cityFromPath('/de/geneve/')).toBe('geneva');
    expect(cityFromPath('/geneve')).toBe('geneva');
    expect(cityFromPath('/english')).toBe('zurich');
  });
  it('keeps the language when switching cities', () => {
    expect(cityLink('zurich', '?drink=beer', '/', 'en')).toBe('/en?drink=beer');
    expect(cityLink('bern', '?bar=node%2F1', '/wobillig/', 'en')).toBe('/wobillig/en/bern');
    expect(localeFromPath('/en/bern')).toBe('en');
    expect(localeFromPath('/wobillig/en', '/wobillig/')).toBe('en');
    expect(localeFromPath('/bern')).toBe('de');
    expect(localeFromPath('/english')).toBe('de');
  });
  it('keeps category filters but drops a venue from the previous city', () => {
    expect(cityLink('basel', '?drink=coffee&bar=node%2F1')).toBe('/basel?drink=coffee');
    expect(cityLink('zurich', '?size=500&beerType=draft', '/wobillig/')).toBe('/wobillig/?size=500&beerType=draft');
    expect(new URL(barLink('https://example.org/bern', 'node/1', 'beer', '500')).pathname).toBe('/bern');
  });
  it('preserves existing Zürich entries and isolates all cities and environments', () => {
    expect(cityStoragePath('zurich', true)).toBe('prices/production.json');
    expect(cityStoragePath('zurich', false)).toBe('prices/development.json');
    const paths = Object.keys(cities).flatMap(city => [true, false].map(production => cityStoragePath(city as keyof typeof cities, production)));
    expect(new Set(paths).size).toBe(Object.keys(cities).length * 2);
  });
});

it('opens the new cities in English by default and preserves explicit German links', () => {
  expect(defaultCityLocale('lausanne', 'de')).toBe('en');
  expect(defaultCityLocale('geneva', 'de')).toBe('en');
  expect(defaultCityLocale('basel', 'de')).toBe('de');
  expect(cityLink('geneva', '?drink=beer&bar=node%2F1', '/', 'en')).toBe('/en/geneve?drink=beer');
  expect(cityLink('lausanne', '', '/', 'de')).toBe('/de/lausanne');
});
