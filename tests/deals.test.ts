import { afterEach, expect, it, vi } from 'vitest';
import { currentDeal, searchDeals, visibleDealPreview, type DealBatch } from '../src/deal-data';
import { importDeals, assignDeal, recordDealFailure } from '../server/deals';
import { emptyState, WriteConflict, type Store } from '../server/prices';
import handler from '../api/deals';
import type { IncomingMessage, ServerResponse } from 'node:http';

const now = Date.parse('2026-10-20T10:00:00Z');
const sourceUrl = 'https://epaper.coop.ch/catalogs/AM_AKMA_W42_2026_DE_ZZ--SHORTTERM/pdf/save/bk_1.pdf';
const batch: DealBatch = { source: { id: 'test', chain: 'coop', label: 'Test', url: sourceUrl, sha256: 'a'.repeat(64), fetchedAt: new Date(now).toISOString(), scopeLabel: 'Ungeprüfte Ausgabe' }, offers: [
  { id: 'sugar', chain: 'coop', product: 'Zucker', quantity: '10 kg', category: 'food', priceChf: 9, previousPriceChf: 18, priceBasis: 'pro Packung', conditions: 'Solange Vorrat', validFrom: '2026-10-15', validThrough: '2026-10-21', sourceUrl, sourcePage: 1, evidence: 'Zucker 9 statt 18' },
], branches: [{ id: 'node/123', chain: 'coop', name: 'Coop Test', address: 'Teststrasse 1', postcode: '8001', lat: 47.378, lon: 8.535, sourceUrl: 'https://www.openstreetmap.org/node/123' }] };
function memory(): Store { let state = emptyState(), revision = 0; return {
  read: async () => ({ state: structuredClone(state), etag: String(revision) }),
  write: async (next, etag) => { if (etag !== String(revision)) throw new WriteConflict(); state = structuredClone(next); revision++; },
}; }
afterEach(() => vi.unstubAllEnvs());
it('expires at Swiss midnight and searches only current offers', () => {
  const offer = batch.offers[0];
  expect(currentDeal(offer, Date.parse('2026-10-21T21:59:59Z'))).toBe(true);
  expect(currentDeal(offer, Date.parse('2026-10-21T22:00:00Z'))).toBe(false);
  expect(searchDeals(batch.offers, 'coop zucker', '', '', true, now)).toHaveLength(1);
  expect(searchDeals(batch.offers, '', 'migros', '', false, now)).toHaveLength(0);
  expect(currentDeal({ ...offer, validFrom: '2026-10-22' }, now)).toBe(false);
});
it('imports privately, requires branch evidence, preserves failures and invalidates changed-snapshot assignments', async () => {
  const store = memory(); const pilot = await importDeals(store, batch, now);
  expect(pilot.assignments).toEqual([]);
  const input = { action: 'confirm', revision: pilot.revision, fingerprint: pilot.fingerprint, branchId: 'node/123', offerId: 'sugar' };
  await expect(assignDeal(store, input, now)).rejects.toMatchObject({ status: 400 });
  const saved = await assignDeal(store, { ...input, evidenceUrl: 'https://www.coop.ch/filiale', evidence: 'Explizite Filialangabe im Händlerbeleg' }, now);
  expect(saved.assignments).toHaveLength(1);
  await expect(assignDeal(store, { ...input, action: 'remove' }, now)).rejects.toMatchObject({ status: 409 });
  await recordDealFailure(store, now + 1000);
  const failed = (await store.read()).state.dealPilot!;
  expect(failed.lastSuccessAt).toBe(batch.source.fetchedAt); expect(failed.batch?.offers[0].validThrough).toBe('2026-10-21');
  expect(visibleDealPreview(failed, Date.parse('2026-10-22T00:00:00Z')).batch?.offers).toEqual([]);
  expect(visibleDealPreview(failed, Date.parse('2026-10-22T00:00:00Z')).assignments).toEqual([]);
  const repeat = await importDeals(store, { ...batch, source: { ...batch.source, fetchedAt: new Date(now + 2000).toISOString() } }, now + 2000);
  expect(repeat.assignments).toHaveLength(1);
  const changed = await importDeals(store, { ...batch, offers: [{ ...batch.offers[0], priceChf: 8 }] }, now + 3000).catch(error => error);
  expect(changed.status).toBe(409); // A late older fetch cannot overwrite the last success.
  const next = await importDeals(store, { ...batch, source: { ...batch.source, fetchedAt: new Date(now + 3000).toISOString() }, offers: [{ ...batch.offers[0], priceChf: 8 }] }, now + 3000);
  expect(next.assignments).toEqual([]); expect((await store.read()).state.customMaps).toBeUndefined();
});
it('rejects invalid dates, sources, stale data and duplicate IDs', async () => {
  for (const modified of [
    { ...batch, source: { ...batch.source, url: 'https://evil.example/feed' } },
    { ...batch, offers: [{ ...batch.offers[0], validThrough: '2026-02-30' }] },
    { ...batch, offers: [batch.offers[0], batch.offers[0]] },
  ]) await expect(importDeals(memory(), modified, now)).rejects.toMatchObject({ status: 400 });
  await expect(importDeals(memory(), batch, now + 3 * 86400000)).rejects.toMatchObject({ status: 422 });
});
it('requires reviewer authentication for HTML, JSON and writes before reading storage', async () => {
  vi.stubEnv('MAP_REVIEW_PASSWORD', 'test');
  for (const [method, url] of [['GET', '/api/deals'], ['GET', '/api/deals?view=preview'], ['POST', '/api/deals'], ['HEAD', '/api/deals']]) {
    const req = { method, url, headers: {} } as IncomingMessage;
    let body = ''; const res = { statusCode: 0, setHeader() {}, end(value = '') { body = value; } } as unknown as ServerResponse;
    await handler(req, res); expect(res.statusCode).toBe(401); expect(body).not.toContain('Zucker');
  }
});
