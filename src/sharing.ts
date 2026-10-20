import type { Filters } from './data';
import type { Drink } from './community';
import { parsePizzaSelection } from './pizza-selection';

// Old shared beer links used only size/beerType; keep those entry points working.
export function drinkFromSearch(params: URLSearchParams): Drink {
  const drink = params.get('drink');
  if (drink === 'beer' || drink === 'coffee' || drink === 'pizza') return drink;
  if (!drink && (params.has('size') || params.has('beerType'))) return 'beer';
  return 'coffee';
}

export function barLink(href: string, barId: string, drink: Drink, volume: string, beerType: Filters['beerType'] = 'all'): string {
  const url = new URL(href);
  const pizzaSelection = parsePizzaSelection(url.searchParams.get('pizzaSelection'));
  const pizzaQuery = url.searchParams.get('pizzaQuery');
  url.search = '';
  url.hash = '';
  url.searchParams.set('bar', barId);
  url.searchParams.set('drink', drink);
  if (drink === 'pizza') {
    if (pizzaSelection) url.searchParams.set('pizzaSelection', pizzaSelection);
    if (pizzaQuery) url.searchParams.set('pizzaQuery', pizzaQuery);
  }
  if (drink === 'beer') {
    url.searchParams.set('size', volume);
    if (beerType && beerType !== 'all') url.searchParams.set('beerType', beerType);
  }
  return url.href;
}

type ShareBrowser = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

export async function shareLink(data: ShareData & { url: string }, browser: ShareBrowser = navigator): Promise<'shared' | 'cancelled' | 'copied' | 'manual'> {
  if (browser.share) {
    try {
      // Invoke immediately from the click, while user activation is still valid.
      await browser.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (browser.clipboard) {
      await browser.clipboard.writeText(data.url);
      return 'copied';
    }
  } catch { /* Keep the link available even when clipboard access is denied. */ }
  return 'manual';
}
