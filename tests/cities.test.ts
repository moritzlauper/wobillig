import { describe, expect, it } from 'vitest';
import { cities, cityFromPath, cityLink, cityStoragePath } from '../src/cities';
import { barLink } from '../src/sharing';

describe('city navigation and storage isolation', () => {
  it('resolves direct and trailing-slash URLs, including a deployment base', () => {
    expect(cityFromPath('/')).toBe('zurich');
    expect(cityFromPath('/bern')).toBe('bern');
    expect(cityFromPath('/basel/')).toBe('basel');
    expect(cityFromPath('/wobillig/bern/', '/wobillig/')).toBe('bern');
    expect(cityFromPath('/bern-other')).toBe('zurich');
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
    expect(new Set(paths).size).toBe(6);
  });
});
