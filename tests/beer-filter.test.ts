import { describe, expect, it } from 'vitest';
import { bestOffer, cheapPriceLimit, filterBars, matchingOffers, type Bar, type Offer } from '../src/data';
import { cityAverage } from '../src/coverage';
import { filtersFromSearch, writeFilters } from '../src/filters';
import { cityLink } from '../src/cities';
import { barLink } from '../src/sharing';

const lager: Offer = { name: 'Lager', volumeMl: 300, beerType: 'draft', priceChf: 4,
  alcoholFree: false, confidence: 'reviewed', observedAt: '2026-10-20', sourceUrl: 'https://example.org/menu', evidence: '' };
const guinness: Offer = { ...lager, name: 'Guinness Draught', volumeMl: 568, priceChf: 9 };
const pub: Bar = { id: '1', name: 'Pub', type: 'bar', lat: 47, lon: 8, address: '', postcode: '',
  website: null, openingHours: null, outdoor: false, scrapeStatus: 'prices_found', checkedAt: null,
  offers: [lager, guinness] };
const filters = filtersFromSearch(new URLSearchParams('drink=beer&beerQuery=Guinness'));

describe('beer name filter', () => {
  it('shows only recorded matching beers, even with missing prices enabled', () => {
    const unrelated = { ...pub, id: '2', name: 'Guinness Pub', offers: [lager] };
    const unknown = { ...pub, id: '3', offers: [] };
    expect(filters.volume).toBe('all');
    expect(filterBars([unrelated, unknown, pub], filters)).toEqual([pub]);
    expect(bestOffer(pub, filters)).toEqual(guinness);
    expect(cityAverage([pub, unrelated], filters)).toEqual({ price: 9, count: 1 });
    expect(cheapPriceLimit([pub, unrelated], filters)).toBe(9);
    expect(filterBars([pub], { ...filters, max: 8 })).toEqual([]);
  });

  it.each(['guiness', ' GUINNESS ', 'draught guinness', 'guinn'])('matches %s against the product name', beerQuery => {
    expect(bestOffer(pub, { ...filters, beerQuery })).toEqual(guinness);
  });

  it('matches accents and punctuation and requires every search word', () => {
    const venue = { ...pub, offers: [{ ...lager, name: 'Bière de l’Abbaye' }] };
    expect(bestOffer(venue, { ...filters, beerQuery: "BIERE L'ABBAYE" })).toBeDefined();
    expect(bestOffer(pub, { ...filters, beerQuery: 'Guinness Extra' })).toBeUndefined();
  });

  it('combines the name with serving, size, alcohol and freshness filters', () => {
    expect(matchingOffers(pub, { ...filters, volume: '300-330' })).toEqual([]);
    expect(matchingOffers(pub, { ...filters, beerType: 'bottle' })).toEqual([]);
    expect(matchingOffers(pub, { ...filters, alcoholFree: true })).toEqual([]);
    const expired: Offer = { ...guinness, photoSource: { kind: 'google_maps_photo', date: '2020-01-01',
      dateEvidence: '', dateCheckedAt: '2020-01-01', validUntil: '2020-07-01' } };
    expect(filterBars([{ ...pub, offers: [expired] }], filters)).toEqual([]);
    expect(filterBars([{ ...pub, offers: [{ ...guinness, name: 'Guinness Radler' }] }], filters)).toEqual([]);
  });

  it('does not restrict coffee or a cleared beer search', () => {
    expect(filterBars([pub], { ...filters, drink: 'coffee' })).toEqual([pub]);
    expect(bestOffer(pub, { ...filters, beerQuery: ' ' })).toEqual(lager);
  });

  it('preserves the beer query and explicit size across reloads, city links and sharing', () => {
    for (const volume of ['all', '300-330', '500']) {
      const selected = { ...filters, volume };
      const params = new URLSearchParams();
      writeFilters(params, selected, false);
      expect(filtersFromSearch(params)).toEqual(selected);
      const city = new URL(cityLink('bern', params.toString()), 'https://wobillig.ch');
      expect(filtersFromSearch(city.searchParams)).toEqual(selected);
      const shared = new URL(barLink(`https://wobillig.ch/?${params}`, pub.id, 'beer', volume));
      expect(filtersFromSearch(shared.searchParams)).toMatchObject({ beerQuery: 'Guinness', volume });
      expect(new URL(barLink(shared.href, pub.id, 'coffee', volume)).searchParams.has('beerQuery')).toBe(false);
    }
  });

  it('supports a query-only link, bounds URL input and removes a cleared query', () => {
    expect(filtersFromSearch(new URLSearchParams('beerQuery=Guinness')).drink).toBe('beer');
    expect(filtersFromSearch(new URLSearchParams({ beerQuery: 'x'.repeat(200) })).beerQuery).toHaveLength(120);
    const params = new URLSearchParams('beerQuery=Guinness');
    writeFilters(params, { ...filters, beerQuery: '' }, false);
    expect(params.has('beerQuery')).toBe(false);
    const coffee = { ...filters, drink: 'coffee' as const, volume: '300-330' };
    writeFilters(params, coffee, false);
    expect(filtersFromSearch(params)).toEqual(coffee);
  });
});
