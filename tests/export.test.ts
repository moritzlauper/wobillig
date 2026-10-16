import { describe, expect, it } from 'vitest';
import { createExport, exportCsv } from '../src/export';
import { offerKey, type PriceEntry } from '../src/community';
import type { Bar, Dataset, Offer } from '../src/data';

const offer: Offer = { name: 'Lager', volumeMl: null, serving: 'stange', priceChf: 5.3, sourceUrl: 'https://example.org/menu', observedAt: '2026-10-15', confidence: 'reviewed', evidence: 'Stange; "Lager"\n5.30', alcoholFree: false, beerTypeEstimate: { type: 'draft', reason: 'Stange', method: 'rules' } };
const bar: Bar = { id: 'node/1', name: 'Café "Bär"; Bern', lat: 46.95, lon: 7.45, type: 'cafe', address: 'Testgasse 1', postcode: '3011', website: null, openingHours: null, outdoor: false, offers: [offer], scrapeStatus: 'prices_found', checkedAt: null };
const dataset: Dataset = { generatedAt: '2026-10-15T12:00:00Z', discoveredAt: '', attribution: 'OSM', bars: [bar, { ...bar, id: 'node/2', offers: [] }] };

// Read CSV independently to check embedded separators, quotes and line breaks.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ';') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  return rows;
}

describe('analysis downloads', () => {
  it('exports all categories with corrections once, keeps unpriced venues in JSON, and leaves sources unchanged', () => {
    const entry: PriceEntry = { id: 'edit-1', barId: bar.id, drink: 'beer', targetKey: offerKey(offer), revision: 2, updatedAt: '', offer: { ...offer, priceChf: 5.8 } };
    const coffee: Dataset = { ...dataset, bars: [{ ...bar, offers: [{ ...offer, coffeeType: 'cappuccino', priceChf: 4.9 }] }] };
    const snapshot = createExport('bern', { beer: dataset, coffee }, [entry], true, '2026-10-16T10:00:00Z');
    expect(snapshot.cityName).toBe('Bern');
    expect(snapshot.missingCategories).toEqual(['pizza']);
    expect(snapshot.datasets.beer?.bars.find(b => b.id === 'node/2')?.offers).toEqual([]);
    const [headers, ...rows] = parseCsv(exportCsv(snapshot));
    const records = rows.map(row => Object.fromEntries(headers.map((key, i) => [key, row[i]])));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ price_chf: '5.8', volume_ml: '', confidence: 'community', community_id: 'edit-1', revision: '2', venue_name: bar.name, evidence: offer.evidence, effective_beer_type: 'draft', beer_type_estimated: 'true', community_loaded: 'true', missing_categories: 'pizza' });
    expect(records[1]).toMatchObject({ category: 'coffee', coffee_type: 'cappuccino', price_chf: '4.9' });
    expect(rows.every(row => row.length === headers.length)).toBe(true);
    expect(dataset.bars[0].offers[0].priceChf).toBe(5.3);
  });

  it('preserves raw JSON strings but neutralizes formulas in CSV, with explicit missing data', () => {
    const data = { ...dataset, bars: [{ ...bar, name: '=HYPERLINK("https://example.org")', offers: [{ ...offer, evidence: '\t+SUM(1;2)', photoSource: { kind: 'google_maps_photo' as const, date: '2020-01-01', dateEvidence: '', dateCheckedAt: '', validUntil: '' } }] }] };
    const snapshot = createExport('basel', { beer: data }, [], false);
    const csv = exportCsv(snapshot);
    const [headers, row] = parseCsv(csv);
    const record = Object.fromEntries(headers.map((key, i) => [key, row[i]]));
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(record).toMatchObject({ venue_name: "'" + data.bars[0].name, evidence: "'\t+SUM(1;2)", current_offer: 'false', community_loaded: 'false', missing_categories: 'coffee|pizza' });
    expect(JSON.parse(JSON.stringify(snapshot)).datasets.beer.bars[0].name).toBe(data.bars[0].name);
  });
});
