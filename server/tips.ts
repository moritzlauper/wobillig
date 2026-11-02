import { cities, type City } from '../src/cities.js';

// Same contribution in every city, in Rappen.
export const tipAmount = 200;

export function tipPaymentParams(city: City, amount: number): URLSearchParams {
  return new URLSearchParams({
    amount: String(amount), currency: 'chf',
    'payment_method_types[0]': 'twint', 'payment_method_types[1]': 'card',
    'metadata[site]': 'wobillig', 'metadata[product]': 'wobillig_tip', 'metadata[city]': city,
    description: `wobillig – Plattformkosten – ${cities[city].name}`,
    statement_descriptor_suffix: 'WOBILLIG',
  });
}
