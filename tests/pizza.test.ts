import { describe, it, expect } from 'vitest';
import { bestOffer, cost, isStange, portion, beerTypeLabel, filterBars, type Bar, type Offer, type Filters } from '../src/data';
import { allVenues, applyEntries, validateInput, offerKey } from '../src/community';
import { emptyState, savePrice, type State } from '../server/prices';
import { coverageLabel } from '../src/coverage';
import { barLink } from '../src/sharing';

const pizza: Offer = { name: 'Pizza Margherita', pizzaType: 'margherita', priceChf: 19, volumeMl: null, sourceUrl: 'https://example.org/menu', observedAt: '2026-10-15', confidence: 'automatic', evidence: 'Margherita 19', alcoholFree: true };
const coffee: Offer = { ...pizza, pizzaType: undefined, coffeeType: 'espresso', name: 'Espresso', priceChf: 4 };
const beer: Offer = { ...pizza, pizzaType: undefined, name: 'Lager', priceChf: 6, volumeMl: 300, alcoholFree: false };
const bar: Bar = { id: 'node/1', name: 'Pizzeria', lat: 47.38, lon: 8.53, type: 'restaurant', address: '', postcode: '', website: null, openingHours: null, outdoor: true, offers: [beer, coffee, pizza], scrapeStatus: 'prices_found', checkedAt: null };
const f: Filters = { drink: 'pizza', max: 30, query: '', volume: 'stange', beerType: 'bottle', coffeeType: 'creme', type: '', unknown: false, outdoor: false, alcoholFree: false, mode: 'half', sort: 'price' };
const dataset = { generatedAt: '', discoveredAt: '', attribution: '', bars: [bar] };
const input = { barId: bar.id, drink: 'pizza', pizzaType: 'margherita', name: 'Pizza Margherita', priceChf: 18.5, volumeMl: null, alcoholFree: true, observedAt: '2026-10-15', sourceUrl: '', revision: 0 };

describe('Margherita category', () => {
  it('shows only pizza venues, including those without prices and community additions', () => {
    const unpriced = { ...bar, id: 'node/2', offers: [] };
    const drinksOnly = { ...bar, id: 'node/3', offers: [beer, coffee] };
    const added = { ...bar, id: 'node/4', offers: [coffee] };
    const pizzaData = { ...dataset, bars: [{ ...bar, offers: [pizza] }, unpriced] };
    const venues = [...pizzaData.bars, drinksOnly, added];
    const beerEntry = { id: 'beer-entry', barId: drinksOnly.id, drink: 'beer' as const, targetKey: '', revision: 1, updatedAt: '', offer: beer };
    const pizzaEntry = { ...beerEntry, id: 'pizza-entry', barId: added.id, drink: 'pizza' as const, offer: pizza };
    const result = applyEntries(pizzaData, [beerEntry, pizzaEntry], venues, 'pizza');
    expect(result.bars.map(b => b.id)).toEqual([bar.id, unpriced.id, added.id]);
    expect(filterBars(result.bars, { ...f, unknown: true }).map(b => b.id).sort()).toEqual([bar.id, unpriced.id, added.id]);
    expect(applyEntries({ ...dataset, bars: [drinksOnly] }, [], venues, 'beer').bars).toHaveLength(4);
  });
  it('compares whole pizzas independently of beer/coffee filter state', () => {
    expect(bestOffer(bar, f)).toEqual(pizza);
    expect(cost(pizza, 'half')).toBe(19);
    expect(isStange(pizza)).toBe(false);
    expect(portion(pizza)).toBe('Pro Pizza Margherita');
    expect(beerTypeLabel(pizza)).toBe('');
    expect(filterBars([bar], { ...f, max: 18 })).toEqual([]);
    expect(coverageLabel([bar], f)).toBe('1 Lokale · 1 mit Margherita-Preis · 1 passend zum Filter');
    expect(bestOffer({ ...bar, offers: [pizza] }, { ...f, drink: 'beer', alcoholFree: true, volume: 'all', beerType: 'all', mode: 'glass' })).toBeUndefined();
    expect(bestOffer({ ...bar, offers: [pizza] }, { ...f, drink: 'coffee', coffeeType: 'all' })).toBeUndefined();
  });
  it('shares a pizza entry point without a stale beer size', () => {
    const url = new URL(barLink('https://example.org/?drink=beer&size=stange', bar.id, 'pizza', 'stange'));
    expect(url.searchParams.get('drink')).toBe('pizza');
    expect(url.searchParams.has('size')).toBe(false);
  });
  it.each([{ pizzaType: 'salami' }, { coffeeType: 'espresso' }, { beerType: 'draft' }, { volumeMl: 300 }, { serving: 'stange' }, { name: 'Margherita Kinderpizza' }, { drink: 'beer' }, { drink: 'coffee', coffeeType: 'creme' }])('rejects incompatible pizza input %j', patch => {
    expect(() => validateInput({ ...input, ...patch }, [bar], '2026-10-15')).toThrow();
  });
  it('persists and corrects pizza prices without affecting drink prices', async () => {
    let state: State = emptyState();
    const store = { async read() { return { state: structuredClone(state) }; }, async write(next: State) { state = structuredClone(next); } };
    const data = { beer: { ...dataset, bars: [{ ...bar, offers: [beer] }] }, coffee: { ...dataset, bars: [] }, pizza: { ...dataset, bars: [{ ...bar, offers: [pizza] }] } };
    const value = validateInput({ ...input, targetKey: offerKey(pizza) }, [bar], '2026-10-15');
    const entry = await savePrice(store, value, data, 'test');
    expect(entry.offer.pizzaType).toBe('margherita');
    const venues = allVenues(data);
    const updated = applyEntries(data.pizza, [entry], venues, 'pizza');
    expect(updated.bars[0].offers).toHaveLength(1);
    expect(updated.bars[0].offers[0].priceChf).toBe(18.5);
    expect(applyEntries(data.beer, [entry], venues, 'beer').bars[0].offers).toEqual([beer]);
    const correction = await savePrice(store, { ...value, id: entry.id, revision: entry.revision, priceChf: 20 }, data, 'test');
    expect(correction.revision).toBe(2);
    expect(applyEntries(data.pizza, [correction], venues, 'pizza').bars[0].offers).toHaveLength(1);
  });
});
