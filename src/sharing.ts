import type { Filters } from './data';
import type { Drink } from './community';

export function barLink(href: string, barId: string, drink: Drink, volume: string, beerType: Filters['beerType'] = 'draft'): string {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('bar', barId);
  if (drink !== 'beer') url.searchParams.set('drink', drink);
  else {
    url.searchParams.set('size', volume);
    if (beerType && beerType !== 'draft') url.searchParams.set('beerType', beerType);
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
