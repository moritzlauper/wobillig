import { readFile } from 'node:fs/promises';
import { cities, type City } from '../src/cities.js';
import { cheapPriceLimit, type Dataset } from '../src/data.js';

// Use the published city-wide Cappuccino catalogue and the same algorithm as
// the default «Günstig» filter. Map searches/districts never change a tip.
export async function cappuccinoTipAmount(city: City): Promise<number> {
  const data: Dataset = JSON.parse(await readFile(`${process.cwd()}/public/data/${cities[city].data}coffee.json`, 'utf8'));
  const price = cheapPriceLimit(data.bars, {
    drink: 'coffee', coffeeType: 'cappuccino', query: '', max: Infinity,
    volume: '300-330', type: '', unknown: false, outdoor: false,
    alcoholFree: false, mode: 'glass', sort: 'price',
  });
  if (price === undefined || price < 1 || price > 20) throw new Error('No valid cappuccino price');
  return Math.round(price * 100);
}

export function tipPaymentParams(city: City, amount: number): URLSearchParams {
  return new URLSearchParams({
    amount: String(amount), currency: 'chf',
    'payment_method_types[0]': 'twint', 'payment_method_types[1]': 'card',
    'metadata[site]': 'wobillig', 'metadata[product]': 'wobillig_tip', 'metadata[city]': city,
    description: `wobillig – Plattformkosten – ${cities[city].name}`,
    statement_descriptor_suffix: 'WOBILLIG',
  });
}
