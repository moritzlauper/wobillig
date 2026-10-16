import { bestOffer, cost, filterBars, isCurrentOffer, isComparableOffer, offerCategory, type Bar, type Filters } from './data';

export function cityAverage(bars: Bar[], f: Filters): { price: number; count: number } | undefined {
  // Keep the product comparison, but do not let a search or price ceiling bias the city benchmark.
  const cityFilters: Filters = { ...f, query: '', max: Infinity, type: '', outdoor: false, unknown: false, sort: 'price' };
  const prices = filterBars(bars, cityFilters)
    .map(bar => cost(bestOffer(bar, cityFilters)!, cityFilters.mode))
    .filter(price => Number.isFinite(price) && price > 0);
  if (!prices.length) return undefined;
  return { price: prices.reduce((sum, price) => sum + price, 0) / prices.length, count: prices.length };
}

export function hasDrinkPrice(bar: Bar, f: Filters): boolean {
  return bar.offers.some(o => isCurrentOffer(o) && isComparableOffer(o) && offerCategory(o) === (f.drink || 'beer'));
}

export function missingPriceLabel(bar: Bar, f: Filters): string {
  return hasDrinkPrice(bar, f) ? 'Kein passender Preis' : 'Noch nicht erfasst';
}

export function coverageLabel(bars: Bar[], f: Filters): string {
  const recorded = bars.filter(b => hasDrinkPrice(b, f)).length;
  const matching = bars.filter(b => bestOffer(b, f)).length;
  return `${bars.length} Lokale · ${recorded} mit ${f.drink === 'pizza' ? 'Margherita-Preis' : f.drink === 'coffee' ? 'Kaffeepreis' : 'Bierpreis'} · ${matching} passend zum Filter`;
}
