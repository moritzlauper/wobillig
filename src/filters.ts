import { beerTypeLabels, coffeeLabels, type Filters } from './data';
import { drinkFromSearch } from './sharing';
import { parsePizzaSelection } from './pizza-selection';
import { parseBeerSelection } from './beer-selection';

function choice<T extends string>(params: URLSearchParams, key: string, values: readonly T[], fallback: T): T {
  const value = params.get(key);
  return values.includes(value as T) ? value as T : fallback;
}

export function filtersFromSearch(params: URLSearchParams): Filters {
  const drink = drinkFromSearch(params);
  const pizzaSelection = parsePizzaSelection(params.get('pizzaSelection'));
  const beerSelection = parseBeerSelection(params.get('beerSelection'));
  const amount = params.get('max');
  const max = amount?.trim() && Number.isFinite(Number(amount)) && Number(amount) >= 0.5 ? Number(amount) : Infinity;
  const filters: Filters = {
    drink,
    ...(pizzaSelection ? { pizzaSelection } : {}),
    ...(beerSelection ? { beerSelection } : {}),
    ...(params.get('pizzaQuery')?.trim() ? { pizzaQuery: params.get('pizzaQuery')!.trim().slice(0, 120) } : {}),
    ...(params.get('beerQuery')?.trim() ? { beerQuery: params.get('beerQuery')!.trim().slice(0, 120) } : {}),
    coffeeType: choice(params, 'coffeeType', ['all', ...Object.keys(coffeeLabels)], 'cappuccino'),
    beerType: choice(params, 'beerType', ['all', ...Object.keys(beerTypeLabels)] as NonNullable<Filters['beerType']>[], 'all'),
    query: params.get('q') || '', max,
    volume: choice(params, 'size', ['stange', '300-330', '500', '330', '400', 'all'], drink === 'beer' && (beerSelection || params.get('beerQuery')?.trim()) ? 'all' : '300-330'),
    type: choice(params, 'type', ['', 'all', 'bar', 'restaurant', 'cafe', 'fast_food'], ''),
    unknown: params.get('unknown') !== '0', outdoor: params.get('outdoor') === '1',
    alcoholFree: params.get('alcoholFree') === '1',
    mode: choice(params, 'mode', ['glass', 'half'], 'glass'),
    sort: choice(params, 'sort', ['price', 'price_desc', 'name', 'distance'], 'price'),
  };
  if (['bottle', 'can'].includes(filters.beerType!) && filters.volume === 'stange') filters.volume = 'all';
  return filters;
}

// Persist the underlying filters, not the temporary price cap of cheap mode.
// Only values that differ from the defaults are written, so the default view stays at a bare URL.
export function writeFilters(params: URLSearchParams, f: Filters, cheap: boolean): void {
  const drink = f.drink || 'coffee';
  const beerType = f.beerType && f.beerType !== 'all' ? f.beerType : '';
  const size = f.volume !== '300-330' || (drink === 'beer' && (f.beerSelection || f.beerQuery?.trim())) ? f.volume : '';
  const values = {
    // Without a drink, size or beerType would be read as a legacy beer link.
    drink: drink !== 'coffee' || beerType || size || f.beerSelection || f.beerQuery?.trim() ? drink : '',
    coffeeType: f.coffeeType && f.coffeeType !== 'cappuccino' ? f.coffeeType : '',
    pizzaSelection: f.pizzaSelection || '', pizzaQuery: f.pizzaQuery?.trim() || '',
    beerType, beerSelection: f.beerSelection || '', beerQuery: f.beerQuery?.trim() || '', q: f.query,
    max: Number.isFinite(f.max) ? String(f.max) : '',
    size, type: f.type, unknown: f.unknown ? '' : '0', outdoor: f.outdoor ? '1' : '',
    alcoholFree: f.alcoholFree ? '1' : '', mode: f.mode !== 'glass' ? f.mode : '',
    sort: f.sort !== 'price' ? f.sort : '', cheap: cheap ? '1' : '',
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value); else params.delete(key);
  }
}
