import { describe, expect, it } from 'vitest';
import { pizzaMenuContent } from '../src/pizza-menu';
import { bestOffer, type Bar, type Filters, type PizzaMenuItem } from '../src/data';
import { applyEntries } from '../src/community';

const item: PizzaMenuItem = {
  name: 'Pizza Funghi', pizzaType: 'other', ingredients: 'Tomaten, Mozzarella, Pilze',
  priceChf: 19, volumeMl: null, alcoholFree: true, confidence: 'ai',
  observedAt: '2026-10-19', sourceUrl: 'https://example.org/menu', evidence: 'Pizza Funghi 19',
};

describe('additional pizza menu', () => {
  it('shows sourced prices and ingredients without a redundant portion label or edit action', () => {
    const html = pizzaMenuContent([item]);
    expect(html).toContain('Weitere Pizzen');
    expect(html).toContain('Pizza Funghi');
    expect(html).toContain('CHF 19.00');
    expect(html).toContain('Tomaten, Mozzarella, Pilze');
    expect(html).toContain('href="https://example.org/menu"');
    expect(html).not.toContain('Pro Pizza');
    expect(html).not.toContain('data-edit');
    expect(pizzaMenuContent([])).toBe('');
  });
  it('escapes menu text, rejects unsafe links and leaves unavailable ingredients absent', () => {
    const html = pizzaMenuContent([{ ...item, name: '<img onerror=alert(1)>', ingredients: undefined, sourceUrl: 'javascript:alert(1)' }]);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Tomaten');
    expect(pizzaMenuContent([{ ...item, priceChf: NaN }])).toBe('');
  });
  it('preserves additional pizzas through community merging without changing the comparison price', () => {
    const { pizzaType: _type, ...base } = item;
    const margherita = { ...base, name: 'Pizza Margherita', pizzaType: 'margherita' as const, priceChf: 18 };
    const bar: Bar = { id: '1', name: 'Restaurant', type: 'restaurant', lat: 47.37, lon: 8.54,
      address: '', postcode: '', website: null, openingHours: null, outdoor: false,
      offers: [margherita], pizzaMenu: [{ ...item, priceChf: 12 }], scrapeStatus: 'prices_found', checkedAt: null };
    const merged = applyEntries({ generatedAt: '', discoveredAt: '', attribution: '', bars: [bar] }, [], [], 'pizza');
    const filters: Filters = { drink: 'pizza', query: '', max: 30, volume: 'all', type: '', unknown: false,
      outdoor: false, alcoholFree: false, mode: 'glass', sort: 'price' };
    expect(merged.bars[0].pizzaMenu).toEqual(bar.pizzaMenu);
    expect(bestOffer(merged.bars[0], filters)?.priceChf).toBe(18);
  });
});
