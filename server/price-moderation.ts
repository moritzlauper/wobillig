import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { offerKey, type PriceEntry } from '../src/community.js';
import type { Offer } from '../src/data.js';

export type HeldPrice = { owner: string; entry: PriceEntry; reason: string; before: Offer | null };
const cookieName = 'wobillig-price-view';

// A browser secret, never an IP address. Only its HMAC is stored with held prices.
export function priceOwner(req: IncomingMessage, res: ServerResponse, create = false): string | undefined {
  let token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create) return;
    token = randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${process.env.VERCEL_ENV === 'production' || req.headers.origin?.startsWith('https:') ? '; Secure' : ''}`);
  }
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new Error('Missing storage secret');
  return createHmac('sha256', secret).update(`price-view:${token}`).digest('hex');
}

function sameOffer(a: PriceEntry, b: PriceEntry) {
  return a.id === b.id || (a.barId === b.barId && a.drink === b.drink &&
    (a.targetKey === b.targetKey || offerKey(a.offer) === offerKey(b.offer)));
}

export function visiblePrices(state: { entries: PriceEntry[]; heldPrices?: HeldPrice[] }, owner?: string): PriceEntry[] {
  if (!owner) return state.entries;
  const held = (state.heldPrices || []).filter(item => item.owner === owner).map(item => item.entry);
  return [...state.entries.filter(entry => !held.some(item => sameOffer(entry, item))), ...held];
}

// Conservative guardrails: unusual prices are held for review, not deleted.
// A supplied URL is not proof and must not bypass the checks.
export function priceConcern(entry: PriceEntry, before: Offer | null): string | undefined {
  const offer = entry.offer, price = offer.priceChf;
  if (entry.drink === 'coffee' && (price < 1 || price > 12)) return 'coffee-range';
  if (entry.drink === 'pizza' && (price < 5 || price > 35)) return 'pizza-range';
  if (entry.drink === 'beer' && price < 1) return 'beer-range';
  // Specialty bottles can legitimately cost much more than ordinary beer.
  if (before && offer.volumeMl === before.volumeMl && offer.coffeeType === before.coffeeType &&
      offer.pizzaType === before.pizzaType && offer.alcoholFree === before.alcoholFree &&
      (offer.beerType || 'unknown') === (before.beerType || 'unknown')) {
    if (price >= before.priceChf * 2 && price - before.priceChf >= 5) return 'large-increase';
    if (price <= before.priceChf * .4 && before.priceChf - price >= 3) return 'large-decrease';
  }
}
