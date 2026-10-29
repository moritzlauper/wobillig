import { t } from './i18n';
import { bestOffer, cost, filterBars, isCurrentOffer, isComparableOffer, offerCategory, type Bar, type Filters } from './data';

export function cityAverage(bars: Bar[], f: Filters): { price: number; count: number } | undefined {
  // The venue type shapes the benchmark; search, price ceiling and the other filters must not bias it.
  const cityFilters: Filters = { ...f, query: '', max: Infinity, outdoor: false, unknown: false, sort: 'price' };
  const prices = filterBars(bars, cityFilters)
    .map(bar => cost(bestOffer(bar, cityFilters)!, cityFilters.mode))
    .filter(price => Number.isFinite(price) && price > 0);
  if (!prices.length) return undefined;
  return { price: prices.reduce((sum, price) => sum + price, 0) / prices.length, count: prices.length };
}

export function hasDrinkPrice(bar: Bar, f: Filters): boolean {
  return (f.drink === 'pizza' ? [...bar.offers, ...(bar.pizzaMenu || [])] : bar.offers).some(o => isCurrentOffer(o) && isComparableOffer(o) && offerCategory(o) === (f.drink || 'beer'));
}

export function missingPriceLabel(bar: Bar, f: Filters): string {
  return hasDrinkPrice(bar, f) ? t('Kein passender Preis') : t('Noch nicht erfasst');
}

export function coverageLabel(bars: Bar[], f: Filters): string {
  const recorded = bars.filter(b => hasDrinkPrice(b, f)).length;
  const matching = bars.filter(b => bestOffer(b, f)).length;
  const kind = f.drink === 'pizza' ? t('Pizzapreis') : f.drink === 'ramen' ? t('Ramenpreis') : f.drink === 'burger' ? t('Burgerpreis') : f.drink === 'softdrink' ? t('Softdrinkpreis') : f.drink === 'cocktail' ? t('Cocktailpreis') : f.drink === 'coffee' ? t('Kaffeepreis') : t('Bierpreis');
  return t('{venues} Lokale · {recorded} mit {kind} · {matching} passend zum Filter', { venues: bars.length, recorded, kind, matching });
}
