import { beerTypeLabels, coffeeLabels, type Filters } from './data';
import { drinkFromSearch } from './sharing';

function choice<T extends string>(params: URLSearchParams, key: string, values: readonly T[], fallback: T): T {
  const value = params.get(key);
  return values.includes(value as T) ? value as T : fallback;
}

export function filtersFromSearch(params: URLSearchParams): Filters {
  const drink = drinkFromSearch(params);
  const amount = params.get('max');
  const max = amount === 'all' ? Infinity : amount?.trim() && Number.isFinite(Number(amount)) && Number(amount) >= 0.5 ? Number(amount) : drink === 'pizza' ? 30 : 15;
  const filters: Filters = {
    drink,
    coffeeType: choice(params, 'coffeeType', ['all', ...Object.keys(coffeeLabels)], 'cappuccino'),
    beerType: choice(params, 'beerType', ['all', ...Object.keys(beerTypeLabels)] as NonNullable<Filters['beerType']>[], 'all'),
    query: params.get('q') || '', max,
    volume: choice(params, 'size', ['stange', '300-330', '500', '300', '330', '400', 'all'], '300-330'),
    type: choice(params, 'type', ['', 'bar', 'restaurant', 'cafe', 'fast_food'], ''),
    unknown: params.get('unknown') !== '0', outdoor: params.get('outdoor') === '1',
    alcoholFree: params.get('alcoholFree') === '1',
    mode: choice(params, 'mode', ['glass', 'half'], 'glass'),
    sort: choice(params, 'sort', ['price', 'price_desc', 'name', 'distance'], 'price'),
  };
  if (drink === 'coffee' && filters.type === 'fast_food') filters.type = '';
  if (['bottle', 'can'].includes(filters.beerType!) && filters.volume === 'stange') filters.volume = 'all';
  return filters;
}

// Persist the underlying filters, not the temporary price cap of cheap mode.
export function writeFilters(params: URLSearchParams, f: Filters, cheap: boolean): void {
  const values = {
    drink: f.drink || 'coffee', coffeeType: f.coffeeType || 'cappuccino',
    beerType: f.beerType || 'all', q: f.query, max: Number.isFinite(f.max) ? String(f.max) : 'all',
    size: f.volume, type: f.type, unknown: f.unknown ? '1' : '0', outdoor: f.outdoor ? '1' : '0',
    alcoholFree: f.alcoholFree ? '1' : '0', mode: f.mode, sort: f.sort, cheap: cheap ? '1' : '0',
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value); else params.delete(key);
  }
}
