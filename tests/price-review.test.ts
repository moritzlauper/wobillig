import { describe, expect, it } from 'vitest';
import { reviewRows, reviewCsv, reviewHtml } from '../scripts/price-review.mjs';

const offer = { name: 'Lager', priceChf: 7, volumeMl: 500, alcoholFree: false, observedAt: '2026-10-19', sourceUrl: 'https://example.org/menu' };
const entry = { id: 'entry-1', barId: 'node/1', drink: 'beer', revision: 1, targetKey: 'lager', updatedAt: '2026-10-19T10:00:00Z', offer,
  venue: { name: 'Testbar', address: 'Teststrasse 1' } };
const change = { id: 'change-1', entryId: entry.id, barId: entry.barId, drink: entry.drink, revision: 1, updatedAt: entry.updatedAt,
  venueName: 'Testbar', address: 'Teststrasse 1', source: 'manual', before: { ...offer, priceChf: 8 }, after: offer };

describe('private price review', () => {
  it('includes legacy manual revisions but does not duplicate audited revisions or count scans', () => {
    const rows = reviewRows({ history: [entry], entries: [{ ...entry, revision: 2, offer: { ...offer, priceChf: 6 } },
      { ...entry, id: 'photo', offer: { ...offer, menuScan: { sha256: 'abc' } } }], priceChanges: [change] }, 'bern');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ city: 'bern', revision: 2, exact: false, before: { priceChf: 7 }, after: { priceChf: 6 } });
    expect(rows[1]).toMatchObject({ exact: true, before: { priceChf: 8 } });
  });
  it('does not invent historical catalogue prices and resolves old venue IDs', () => {
    const rows = reviewRows({ history: [], entries: [{ ...entry, venue: undefined }] }, 'basel', [{ id: entry.barId, name: 'Archivbar' }]);
    expect(rows[0]).toMatchObject({ exact: false, before: null, venueName: 'Archivbar' });
    const html = reviewHtml(rows, 'production');
    expect(html).toContain('Unbekannt');
    expect(html).toContain('Altbestand');
  });
  it('escapes stored HTML and rejects unsafe source links', () => {
    const rows = reviewRows({ history: [], entries: [], priceChanges: [{ ...change, venueName: '<img src=x onerror=alert(1)>',
      after: { ...offer, name: '</script><script>alert(1)</script>', sourceUrl: 'javascript:alert(1)' } }] }, 'zurich');
    const html = reviewHtml(rows, 'production');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;img');
    expect(html).toContain('href="https://example.org/menu"');
  });
  it('exports quoted CSV with formula protection and both source snapshots', () => {
    const rows = reviewRows({ history: [], entries: [], priceChanges: [{ ...change, venueName: '=HYPERLINK("bad")',
      after: { ...offer, name: 'Bier; "Hell"', sourceUrl: 'https://example.org/new' } }] }, 'bern');
    const csv = reviewCsv(rows);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"Bier; ""Hell"""');
    expect(csv).toContain('"https://example.org/menu";"https://example.org/new"');
    expect(csv).toContain('"8";"7";"-1"');
  });
  it('renders an empty report and labels development data clearly', () => {
    const html = reviewHtml([], 'development', '2026-10-19T10:00:00Z');
    expect(html).toContain('Entwicklung / Vorschau');
    expect(html).toContain('npm run prices:review -- --development');
    expect(html).toContain('<p id="empty" >Keine manuellen Änderungen');
  });
});
