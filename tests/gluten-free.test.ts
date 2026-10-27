import { describe, expect, it } from 'vitest';
import { isGlutenFreeOffer, isGlutenFreePizzeria } from '../src/gluten-free';
import { hasGlutenFreePizza, matchesPizza, matchingOffers, type Bar, type Filters, type Offer } from '../src/data';

const observedAt = '2026-10-27T12:00:00.000Z';
const offer = (values: Partial<Offer> & Pick<Offer, 'name' | 'priceChf'>): Offer => ({
  volumeMl: null, sourceUrl: 'https://venue.example/', observedAt, confidence: 'automatic', evidence: values.name,
  alcoholFree: false, ...values,
});
const venue = (values: Partial<Bar>): Bar => ({
  id: 'node/1', name: 'Venue', lat: 47.37, lon: 8.54, type: 'restaurant', address: '', postcode: '8001', website: null,
  openingHours: null, outdoor: false, offers: [], scrapeStatus: 'prices_found', checkedAt: observedAt, ...values,
});
const filters = (values: Partial<Filters> = {}): Filters => ({
  drink: 'pizza', query: '', max: Infinity, volume: 'all', type: '', unknown: true, outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price', ...values,
});

describe('gluten-free labels', () => {
  it('reads explicit labels in the name, the ingredients or the scraped flag', () => {
    expect(isGlutenFreeOffer({ name: 'Appenzeller Birra da Ris (glutenfrei)' })).toBe(true);
    expect(isGlutenFreeOffer({ name: 'PERONI GLUTEN-FREE (IT)' })).toBe(true);
    expect(isGlutenFreeOffer({ name: 'Dr. Gab\'s Pépite Glutenfreies Pale Ale' })).toBe(true);
    expect(isGlutenFreeOffer({ name: 'Margherita', ingredients: 'Tomaten, Mozzarella, sans gluten' })).toBe(true);
    expect(isGlutenFreeOffer({ name: 'Burger', glutenFree: true })).toBe(true);
  });

  it('never infers gluten-free from missing or unrelated text', () => {
    expect(isGlutenFreeOffer({ name: 'Margherita', ingredients: 'Tomaten, Mozzarella' })).toBe(false);
    expect(isGlutenFreeOffer({ name: 'Glutenhaltiges Bier' })).toBe(false);
    expect(isGlutenFreeOffer({ name: 'Burger', glutenFree: false })).toBe(false);
  });

  it('treats a pizzeria that calls itself gluten-free as gluten-free', () => {
    expect(isGlutenFreePizzeria({ pizzaEvidence: { evidence: 'Granò — Die glutenfreie Pizzeria in Zürich' } })).toBe(true);
    expect(isGlutenFreePizzeria({ pizzaEvidence: { evidence: 'Gluten-free pizzeria in Bern' } })).toBe(true);
    expect(isGlutenFreePizzeria({ pizzaEvidence: { evidence: 'Pizza mit glutenfreiem Teig auf Wunsch' } })).toBe(false);
    expect(isGlutenFreePizzeria({})).toBe(false);
  });
});

describe('gluten-free pizza and beer', () => {
  const granò = venue({
    name: 'Granò', pizzaEvidence: { sourceUrl: 'https://gra-no.ch', evidence: 'Granò — Die glutenfreie Pizzeria in Zürich' },
    offers: [offer({ name: 'Pizza Margherita', priceChf: 22, pizzaType: 'margherita' })],
    pizzaMenu: [offer({ name: 'Diavola', priceChf: 25, pizzaType: 'other' })],
  });
  const other = venue({ id: 'node/2', name: 'Pizzeria', offers: [offer({ name: 'Margherita', priceChf: 17, pizzaType: 'margherita' })] });

  it('offers gluten-free pizza only where the menu or the pizzeria says so', () => {
    expect(hasGlutenFreePizza([granò, other])).toBe(true);
    expect(hasGlutenFreePizza([other])).toBe(false);
    expect(matchingOffers(granò, filters({ pizzaSelection: 'glutenfree' })).map(o => o.name)).toEqual(['Pizza Margherita', 'Diavola']);
    expect(matchingOffers(other, filters({ pizzaSelection: 'glutenfree' }))).toEqual([]);
  });

  it('does not count a plain margherita as gluten-free without a label or a gluten-free pizzeria', () => {
    expect(matchesPizza(offer({ name: 'Margherita', priceChf: 17, pizzaType: 'margherita' }), filters({ pizzaSelection: 'glutenfree' }))).toBe(false);
  });

  it('filters beer by the gluten-free label only when the filter is on', () => {
    const beer = venue({
      offers: [
        offer({ name: 'Appenzeller Birra da Ris (glutenfrei)', priceChf: 6.5, volumeMl: 330, alcoholFree: false }),
        offer({ name: 'Feldschlösschen Lager', priceChf: 6, volumeMl: 500, alcoholFree: false }),
      ],
    });
    const beerFilters = filters({ drink: 'beer', volume: 'all' });
    expect(matchingOffers(beer, beerFilters)).toHaveLength(2);
    expect(matchingOffers(beer, { ...beerFilters, glutenFree: true }).map(o => o.name)).toEqual(['Appenzeller Birra da Ris (glutenfrei)']);
  });
});
