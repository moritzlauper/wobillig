import { beerTypeLabels, coffeeLabels, type Filters } from './data';
import { drinkFromSearch } from './sharing';
import { parsePizzaSelection } from './pizza-selection';
import { parseBeerSelection } from './beer-selection';
import { parseBurgerSelection } from './burger-selection';
import { cities } from './cities';

export const cheapPreferenceKey = 'wobillig:cheap';

export function cheapModeFromSearch(params: URLSearchParams, preference: string | null): boolean {
  if (params.has('cheap')) return params.get('cheap') === '1';
  // Links made before cheap became the default must retain their original view.
  const selectionKeys = ['drink', 'coffeeType', 'beerType', 'beerSelection', 'beerQuery',
    'pizzaSelection', 'pizzaQuery', 'burgerSelection', 'q', 'max', 'size', 'type', 'unknown', 'outdoor',
    'alcoholFree', 'glutenFree', 'mode', 'sort', 'bar', 'address', 'map',
    ...Object.values(cities).flatMap(city => city.districts ? [city.districts.toggle, city.districts.param] : [])];
  if (selectionKeys.some(key => params.has(key))) return false;
  return preference !== '0';
}

function choice<T extends string>(params: URLSearchParams, key: string, values: readonly T[], fallback: T): T {
  const value = params.get(key);
  return values.includes(value as T) ? value as T : fallback;
}

export function filtersFromSearch(params: URLSearchParams): Filters {
  const drink = drinkFromSearch(params);
  const pizzaSelection = parsePizzaSelection(params.get('pizzaSelection'));
  const beerSelection = parseBeerSelection(params.get('beerSelection'));
  const burgerSelection = parseBurgerSelection(params.get('burgerSelection'));
  const amount = params.get('max');
  const max = amount?.trim() && Number.isFinite(Number(amount)) && Number(amount) >= 0.5 ? Number(amount) : Infinity;
  const filters: Filters = {
    drink,
    ...(pizzaSelection ? { pizzaSelection } : {}),
    ...(beerSelection ? { beerSelection } : {}),
    ...(burgerSelection ? { burgerSelection } : {}),
    ...(params.get('pizzaQuery')?.trim() ? { pizzaQuery: params.get('pizzaQuery')!.trim().slice(0, 120) } : {}),
    ...(params.get('beerQuery')?.trim() ? { beerQuery: params.get('beerQuery')!.trim().slice(0, 120) } : {}),
    coffeeType: choice(params, 'coffeeType', ['all', ...Object.keys(coffeeLabels)], 'cappuccino'),
    beerType: choice(params, 'beerType', ['all', ...Object.keys(beerTypeLabels)] as NonNullable<Filters['beerType']>[], 'all'),
    query: params.get('q') || '', max,
    volume: choice(params, 'size', ['stange', '300-330', '500', '330', '400', 'all'], drink === 'beer' && (beerSelection || params.get('beerQuery')?.trim()) ? 'all' : '300-330'),
    type: choice(params, 'type', ['', 'all', 'bar', 'restaurant', 'cafe', 'fast_food'], ''),
    unknown: params.get('unknown') !== '0', outdoor: params.get('outdoor') === '1',
    alcoholFree: params.get('alcoholFree') === '1',
    ...(params.get('glutenFree') === '1' ? { glutenFree: true } : {}),
    mode: choice(params, 'mode', ['glass', 'half'], 'glass'),
    sort: choice(params, 'sort', ['price', 'price_desc', 'name', 'distance'], 'price'),
  };
  if (['bottle', 'can'].includes(filters.beerType!) && filters.volume === 'stange') filters.volume = 'all';
  return filters;
}

// Persist the underlying filters, not the temporary price cap of cheap mode.
// Write cheap mode so shared links override the recipient's saved preference;
// dropDefaultCheap later removes it where a plain link already opens in cheap mode.
export function writeFilters(params: URLSearchParams, f: Filters, cheap: boolean): void {
  const drink = f.drink || 'coffee';
  const beerType = f.beerType && f.beerType !== 'all' ? f.beerType : '';
  const size = f.volume !== '300-330' || (drink === 'beer' && (f.beerSelection || f.beerQuery?.trim())) ? f.volume : '';
  const values = {
    // Without a drink, size or beerType would be read as a legacy beer link.
    drink: drink !== 'coffee' || beerType || size || f.beerSelection || f.beerQuery?.trim() ? drink : '',
    coffeeType: f.coffeeType && f.coffeeType !== 'cappuccino' ? f.coffeeType : '',
    pizzaSelection: f.pizzaSelection || '', pizzaQuery: f.pizzaQuery?.trim() || '',
    burgerSelection: f.burgerSelection && f.burgerSelection !== 'all' ? f.burgerSelection : '',
    beerType, beerSelection: f.beerSelection || '', beerQuery: f.beerQuery?.trim() || '', q: f.query,
    max: Number.isFinite(f.max) ? String(f.max) : '',
    size, type: f.type, unknown: f.unknown ? '' : '0', outdoor: f.outdoor ? '1' : '',
    alcoholFree: f.alcoholFree ? '1' : '', glutenFree: f.glutenFree ? '1' : '', mode: f.mode !== 'glass' ? f.mode : '',
    sort: f.sort !== 'price' ? f.sort : '', cheap: cheap ? '1' : '0',
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value); else params.delete(key);
  }
}

function savedCheapPreference(): string | null {
  try { return localStorage.getItem(cheapPreferenceKey); } catch { return null; }
}

// Keep shared default views as plain wobillig.ch or wobillig.ch/bern links.
// cheap is dropped in both directions once the plain URL already opens in that mode for this browser.
export function dropDefaultCheap(params: URLSearchParams, preference = savedCheapPreference()): void {
  const value = params.get('cheap');
  if (value !== '0' && value !== '1') return;
  const rest = new URLSearchParams(params);
  rest.delete('cheap');
  if ((value === '1') === cheapModeFromSearch(rest, preference)) params.delete('cheap');
}
