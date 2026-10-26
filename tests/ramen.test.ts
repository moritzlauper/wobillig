import { expect, it } from 'vitest';
import { applyEntries, offerKey, validateInput, type PriceEntry } from '../src/community';
import { matchingOffers, offerCategory, type Bar, type Dataset, type Filters, type Offer } from '../src/data';
import { priceConcern } from '../server/price-moderation';

const today = '2026-10-26';
const bar = (id: string, name: string, offers: Offer[] = []): Bar => ({ id, name, lat: 47.37, lon: 8.54, type: 'restaurant', address: 'Teststrasse 1',
  postcode: '8004', website: null, openingHours: null, outdoor: false, offers, scrapeStatus: 'prices_found', checkedAt: null });
const ramenOffer = (name: string, priceChf: number): Offer => ({ name, volumeMl: null, ramenType: 'ramen', priceChf, sourceUrl: 'https://ramen.example/menu',
  observedAt: today, confidence: 'ai', evidence: `${name} ${priceChf}`, alcoholFree: true });
const beerOffer: Offer = { name: 'Lager', volumeMl: 300, priceChf: 6, sourceUrl: 'https://bar.example/', observedAt: today, confidence: 'automatic', evidence: 'Lager 6', alcoholFree: false };
const filters = (drink: Filters['drink']): Filters => ({ drink, query: '', max: Infinity, volume: 'all', type: '', unknown: true, outdoor: false,
  alcoholFree: false, mode: 'glass', sort: 'price' });

it('accepts a named ramen dish without drink details and stores it as ramen', () => {
  const input = validateInput({ revision: 0, barId: 'node/1', drink: 'ramen', name: ' Shoyu Ramen ', priceChf: 22, volumeMl: null, alcoholFree: false,
    observedAt: today, sourceUrl: '' }, [bar('node/1', 'Mori Ramen')], today);
  expect(input).toMatchObject({ drink: 'ramen', name: 'Shoyu Ramen', ramenType: 'ramen', volumeMl: null, alcoholFree: true, priceChf: 22 });
});

it('rejects ramen entries that are not a ramen dish or carry drink details', () => {
  const base = { revision: 0, barId: 'node/1', drink: 'ramen', priceChf: 22, volumeMl: null, alcoholFree: false, observedAt: today, sourceUrl: '' };
  const venues = [bar('node/1', 'Mori Ramen')];
  expect(() => validateInput({ ...base, name: 'Schnitzel' }, venues, today)).toThrow('Ramen-Sorte');
  expect(() => validateInput({ ...base, name: 'Shoyu Ramen', volumeMl: 300 }, venues, today)).toThrow('Ramen-Sorte');
  expect(() => validateInput({ ...base, name: 'Shoyu Ramen', coffeeType: 'espresso' }, venues, today)).toThrow('Ramen-Sorte');
});

it('keeps ramen offers apart from beer and pizza', () => {
  expect(offerCategory(ramenOffer('Shoyu Ramen', 22))).toBe('ramen');
  expect(offerCategory(beerOffer)).toBe('beer');
  expect(offerKey(ramenOffer('Shoyu Ramen', 22))).toContain('ramen');
  const venue = bar('node/1', 'Mori Ramen', [beerOffer, ramenOffer('Shoyu Ramen', 22), ramenOffer('Miso Ramen', 24)]);
  expect(matchingOffers(venue, filters('ramen')).map(o => o.name)).toEqual(['Shoyu Ramen', 'Miso Ramen']);
  expect(matchingOffers(venue, filters('beer')).map(o => o.name)).toEqual(['Lager']);
});

it('shows only venues from the ramen dataset, like pizza', () => {
  const dataset: Dataset = { generatedAt: today, discoveredAt: today, attribution: '', bars: [bar('node/1', 'Mori Ramen', [ramenOffer('Shoyu Ramen', 22)])] };
  const venues = [bar('node/2', 'Bar ohne Ramen')];
  expect(applyEntries(dataset, [], venues, 'ramen').bars.map(b => b.id)).toEqual(['node/1']);
});

it('holds implausible ramen prices for review', () => {
  const entry = (priceChf: number) => ({ id: 'e', barId: 'node/1', drink: 'ramen', targetKey: 'k', revision: 1, updatedAt: today,
    offer: ramenOffer('Shoyu Ramen', priceChf) }) as PriceEntry;
  expect(priceConcern(entry(3), null)).toBe('ramen-range');
  expect(priceConcern(entry(60), null)).toBe('ramen-range');
  expect(priceConcern(entry(22), null)).toBeUndefined();
});
