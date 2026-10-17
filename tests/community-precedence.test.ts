import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEntries, offerKey, type PriceEntry } from '../src/community';
import type { Bar, Dataset, Offer } from '../src/data';

const offer: Offer = { name: 'Sprint', volumeMl: 300, beerType: 'draft', priceChf: 5.2,
  sourceUrl: '', observedAt: '2026-10-16', confidence: 'community', evidence: '', alcoholFree: false };
const entry: PriceEntry = { id: 'entry-1', barId: 'node/1', drink: 'beer', targetKey: offerKey(offer),
  revision: 2, updatedAt: '2026-10-16T12:00:00Z', offer };
const bar: Bar = { id: 'node/1', name: 'Mars Bar', lat: 47, lon: 8, type: 'bar', address: '', postcode: '',
  website: 'https://example.org', openingHours: null, outdoor: false, offers: [], checkedAt: null, scrapeStatus: 'prices_found' };
const dataset: Dataset = { generatedAt: '', discoveredAt: '', attribution: '', bars: [bar] };
const website: Offer = { ...offer, priceChf: 6, sourceUrl: 'https://example.org/menu.pdf', observedAt: '2026-10-20',
  confidence: 'reviewed', verifiedMenuDate: { date: '2026-10-17', evidence: 'Preise gültig ab 17.10.2026', sha256: 'a'.repeat(64) } };
const merge = (sources: Offer[], contribution = entry) => applyEntries({ ...dataset, bars: [{ ...bar, offers: sources }] },
  [contribution], [bar], 'beer').bars[0].offers;

describe('contributions versus website prices', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each([undefined, { sha256: 'b'.repeat(64), model: 'ocr' }])('keeps manual and photo contributions after a newer fetch (%j)', menuScan => {
    const result = merge([{ ...website, verifiedMenuDate: undefined }], { ...entry, offer: { ...offer, menuScan } });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ priceChf: 5.2, communityId: entry.id, menuScan });
  });

  it('uses a changed price only from a demonstrably newer verified menu, retaining edit identity', () => {
    const result = merge([website]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ priceChf: 6, confidence: 'reviewed', sourceUrl: website.sourceUrl,
      communityId: entry.id, revision: 2, originalKey: entry.targetKey });
    expect(entry.offer.priceChf).toBe(5.2);
    expect(merge([website], { ...entry, updatedAt: '2026-10-18T12:00:00Z' })[0].priceChf).toBe(5.2);
  });

  it.each(['2026-10-15', '2026-10-16', '2026-10-21', '2026-02-30', '2026-10'])('rejects old, same-day, future and ambiguous menu dates: %s', date => {
    expect(merge([{ ...website, verifiedMenuDate: { ...website.verifiedMenuDate!, date } }])[0].priceChf).toBe(5.2);
  });

  it('compares against the upload time in Zurich, not an older observation date', () => {
    const uploaded = { ...entry, updatedAt: '2026-10-16T23:30:00Z', offer: { ...offer, observedAt: '2026-01-01', menuScan: { sha256: 'x', model: 'ocr' } } };
    expect(merge([website], uploaded)[0].priceChf).toBe(5.2);
  });

  it.each<Partial<Offer>>([
    { confidence: 'ai' }, { confidence: 'automatic' }, { sourceUrl: '' },
    { menuScan: { sha256: 'x', model: 'ocr' } },
    { verifiedMenuDate: { ...website.verifiedMenuDate!, evidence: '' } },
    { verifiedMenuDate: { ...website.verifiedMenuDate!, sha256: 'invalid' } },
  ])('requires a verified website document: %j', patch => {
    expect(merge([{ ...website, ...patch }])[0].priceChf).toBe(5.2);
  });

  it('keeps the contribution if prices agree or equally recent sources conflict', () => {
    expect(merge([{ ...website, priceChf: 5.2 }])[0].confidence).toBe('community');
    for (const priceChf of [5.2, 7]) {
      expect(merge([website, { ...website, sourceUrl: 'https://example.org/other.pdf', priceChf }])[0].priceChf).toBe(5.2);
    }
  });

  it('does not use a newer bottle price to replace the draft contribution', () => {
    const result = merge([{ ...website, beerType: 'bottle' }]);
    expect(result).toHaveLength(2);
    expect(result.find(o => o.communityId === entry.id)?.priceChf).toBe(5.2);
  });
});
