import { expect, it } from 'vitest';
import { checkPriceEdit } from '../server/price-edit-rules';
import type { PriceChange } from '../server/price-audit';
import { type PriceEntry } from '../src/community';
import type { Offer } from '../src/data';
const now = Date.parse('2026-10-20T12:00:00Z');
const offer = (priceChf: number): Offer => ({ name: 'Cappuccino', priceChf, volumeMl: null, coffeeType: 'cappuccino', alcoholFree: true, observedAt: '2026-10-20', sourceUrl: '', confidence: 'community', evidence: '' });
const entry = (price: number, time = now): PriceEntry => ({ id: 'one', barId: 'venue', drink: 'coffee', targetKey: 'key', revision: 1, offer: offer(price), updatedAt: new Date(time).toISOString() });
const change = (before: number, after: number, time: number): PriceChange => ({ id: String(time), entryId: 'one', revision: 1, barId: 'venue', venueName: 'Example', address: '', drink: 'coffee', targetKey: 'key', source: 'manual', updatedAt: new Date(time).toISOString(), before: offer(before), after: offer(after) });
it('allows small corrections and requires a photo only when both thresholds are met', () => {
  for (const [before, after] of [[5, 6.99], [10, 13], [5, 3.01]]) expect(() => checkPriceEdit(entry(after), offer(before), [], now)).not.toThrow();
  for (const [before, after] of [[5, 7], [10, 13.01], [5, 3]]) expect(() => checkPriceEdit(entry(after), offer(before), [], now)).toThrow('Menükarte');
  expect(() => checkPriceEdit(entry(20), null, [], now)).not.toThrow();
});
it('combines smaller steps over 24 hours across visitors and permits six price changes', () => {
  const history = [change(5, 6, now - 1000)];
  expect(() => checkPriceEdit(entry(7), offer(6), history, now)).toThrow('Menükarte');
  const repeated = Array.from({ length: 6 }, (_, i) => change(5 + i / 10, 5 + (i + 1) / 10, now - (6 - i) * 1000));
  expect(() => checkPriceEdit(entry(5.4), offer(5.3), repeated.slice(0, 3), now)).not.toThrow();
  expect(() => checkPriceEdit(entry(5.4), offer(5.3), repeated, now)).toThrow('mehrfach');
  expect(() => checkPriceEdit(entry(5.3), offer(5.3), repeated, now)).not.toThrow();
  expect(() => checkPriceEdit(entry(5.4), offer(5.3), repeated, now + 86400000)).not.toThrow();
});
it('resets the cumulative baseline after a photo-confirmed correction and ignores other offers', () => {
  const history = [change(5, 6, now - 3000), { ...change(6, 7, now - 2000), source: 'menu-scan' as const }];
  expect(() => checkPriceEdit(entry(8), offer(7), history, now)).not.toThrow();
  expect(() => checkPriceEdit({ ...entry(7), id: 'two', targetKey: 'different' }, offer(6), [change(5, 6, now - 1000)], now)).not.toThrow();
});
it('holds large soft drink and cocktail corrections for review, since no menu photo can prove them', () => {
  const cocktail = { ...entry(15), drink: 'cocktail' as const, offer: { ...offer(15), name: 'Caipirinha', coffeeType: undefined, gastroType: 'cocktail' as const } };
  expect(checkPriceEdit(cocktail, { ...cocktail.offer, priceChf: 10 }, [], now)).toBe('large-change');
  expect(checkPriceEdit(cocktail, { ...cocktail.offer, priceChf: 14 }, [], now)).toBeUndefined();
});
