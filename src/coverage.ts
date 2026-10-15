import { bestOffer, isCurrentOffer, isComparableOffer, offerCategory, type Bar, type Filters } from './data';

export function hasDrinkPrice(bar: Bar, f: Filters): boolean {
  return bar.offers.some(o => isCurrentOffer(o) && isComparableOffer(o) && offerCategory(o) === (f.drink || 'beer'));
}

export function missingPriceLabel(bar: Bar, f: Filters): string {
  return hasDrinkPrice(bar, f) ? 'Kein passender Preis' : 'Noch nicht erfasst';
}

export function coverageLabel(bars: Bar[], f: Filters): string {
  const recorded = bars.filter(b => hasDrinkPrice(b, f)).length;
  const matching = bars.filter(b => bestOffer(b, f)).length;
  return `${bars.length} Lokale · ${recorded} mit ${f.drink === 'coffee' ? 'Kaffeepreis' : 'Bierpreis'} · ${matching} passend zum Filter`;
}
