import { describe, expect, it } from 'vitest';
import { filtersFromSearch, writeFilters } from '../src/filters';
import { cityLink } from '../src/cities';
import type { Filters } from '../src/data';

describe('filters across city navigation', () => {
  it.each(['coffee', 'beer', 'pizza'] as const)('preserves every %s filter and cheap mode through all city links', drink => {
    const filters: Filters = {
      drink, coffeeType: 'matcha_latte', beerType: 'bottle', query: 'Café & Bar', max: 7.5,
      volume: '330', type: 'cafe', unknown: false, outdoor: true, alcoholFree: true, mode: 'half', sort: 'price_desc',
    };
    const params = new URLSearchParams('bar=node/1');
    writeFilters(params, filters, true);
    for (const city of ['zurich', 'bern', 'basel'] as const) {
      const url = new URL(cityLink(city, params.toString()), 'https://wobillig.ch');
      expect(filtersFromSearch(url.searchParams)).toEqual(filters);
      expect(url.searchParams.get('cheap')).toBe('1');
      expect(url.searchParams.has('bar')).toBe(false);
    }
  });
  it.each(['coffee', 'beer', 'pizza'] as const)('defaults %s to no takeaways and preserves explicit choices', drink => {
    expect(filtersFromSearch(new URLSearchParams({ drink })).type).toBe('');
    for (const type of ['all', 'fast_food']) {
      const filters = filtersFromSearch(new URLSearchParams({ drink, type }));
      const params = new URLSearchParams();
      writeFilters(params, filters, false);
      expect(filtersFromSearch(params).type).toBe(type);
      for (const city of ['zurich', 'bern', 'basel'] as const) {
        expect(filtersFromSearch(new URL(cityLink(city, params.toString()), 'https://wobillig.ch').searchParams).type).toBe(type);
      }
    }
  });
  it('restores defaults and unlimited prices without turning a blank limit into zero', () => {
    const defaults = filtersFromSearch(new URLSearchParams());
    expect(defaults).toMatchObject({ drink: 'coffee', coffeeType: 'cappuccino', max: 15, unknown: true });
    const params = new URLSearchParams();
    writeFilters(params, { ...defaults, max: Infinity, sort: 'distance' }, false);
    expect(filtersFromSearch(params)).toEqual({ ...defaults, max: Infinity, sort: 'distance' });
    for (const max of ['', 'NaN', '-5', '0', 'Infinity']) {
      expect(filtersFromSearch(new URLSearchParams({ max })).max).toBe(15);
    }
  });
  it('keeps the default view at a bare URL', () => {
    const params = new URLSearchParams('drink=coffee&coffeeType=cappuccino&beerType=all&max=15&size=300-330&unknown=1&outdoor=0&alcoholFree=0&mode=glass&sort=price&cheap=0');
    writeFilters(params, filtersFromSearch(params), false);
    expect(params.toString()).toBe('');
    writeFilters(params, { ...filtersFromSearch(new URLSearchParams()), drink: 'pizza', max: 30 }, false);
    expect(params.toString()).toBe('drink=pizza');
    const coffee = { ...filtersFromSearch(new URLSearchParams()), beerType: 'draft' as const };
    writeFilters(params, coffee, false);
    expect(filtersFromSearch(params)).toEqual(coffee);
  });
  it('validates query values and keeps legacy beer links', () => {
    expect(filtersFromSearch(new URLSearchParams('size=stange'))).toMatchObject({ drink: 'beer', volume: 'stange' });
    expect(filtersFromSearch(new URLSearchParams('drink=coffee&type=fast_food&coffeeType=matcha&sort=invalid')))
      .toMatchObject({ type: 'fast_food', coffeeType: 'cappuccino', sort: 'price' });
    expect(filtersFromSearch(new URLSearchParams('drink=beer&beerType=can&size=stange'))).toMatchObject({ volume: 'all' });
  });
});
