import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { del } from '@vercel/blob';
import { blobStore, emptyState, savePrice } from '../server/prices';
import { reviewMap } from '../server/map-review';
import { mapFingerprint } from '../server/custom-maps';
import { publicMapSummaries, type CustomMap } from '../src/custom-map-data';
import { offerKey, type PriceInput } from '../src/community';
import type { Dataset } from '../src/data';

it.skipIf(process.env.RUN_BLOB_INTEGRATION !== '1')('persists map approval and rejection and lists only the approved map across store instances', async () => {
  const path = `tests/map-review-${randomUUID()}.json`;
  const maps: CustomMap[] = ['Approve test map', 'Reject test map'].map(name => ({
    id: randomUUID(), name, createdAt: '2026-10-21T10:00:00Z',
    publication: { status: 'pending', requestedAt: '2026-10-21T10:00:00Z', fingerprint: '' },
    entries: [{ venue: { id: 'node/1', name: 'Test shop', address: 'Test 1', postcode: '8001', lat: 47.378, lon: 8.535 },
      product: 'Test product', priceChf: 5, revision: 1, updatedAt: '2026-10-21T10:00:00Z' }],
  }));
  try {
    await blobStore(path).write({ ...emptyState(), customMaps: maps });
    for (const [index, map] of maps.entries()) await reviewMap(blobStore(path), map.id, mapFingerprint(map), index === 0);
    const saved = (await blobStore(path).read()).state.customMaps!;
    expect(saved[0].publication?.status).toBe('approved');
    expect(saved[0].publishedAt).toBeTruthy();
    expect(saved[1].publication?.status).toBe('rejected');
    expect(saved[1].publishedAt).toBeUndefined();
    expect(publicMapSummaries(saved)).toEqual([{ id: maps[0].id, name: maps[0].name, venueCount: 1 }]);
  } finally { await del(path); }
}, 60000);

// Explicit opt-in; uses a temporary key, never either live dataset.
it.skipIf(process.env.RUN_BLOB_INTEGRATION !== '1')('persists repeated edits and concurrent additions across store instances', async () => {
  const path = `tests/prices-${randomUUID()}.json`;
  const store = blobStore(path), secondInstance = blobStore(path);
  const beer = JSON.parse(await readFile('public/data/bars.json', 'utf8')) as Dataset;
  const coffee = JSON.parse(await readFile('public/data/coffee.json', 'utf8')) as Dataset;
  const bar = beer.bars.find(b => b.offers.some(o => o.volumeMl === 500))!;
  const offer = bar.offers.find(o => o.volumeMl === 500)!;
  const input: PriceInput = { barId: bar.id, drink: 'beer', revision: 0, targetKey: offerKey(offer), name: offer.name, priceChf: offer.priceChf, volumeMl: 500, alcoholFree: offer.alcoholFree, observedAt: '2026-10-15', sourceUrl: offer.sourceUrl };
  try {
    const entry = await savePrice(store, input, { beer, coffee }, 'test');
    // History grows past the compression threshold, exercising strong ETags on reads.
    for (let revision = 1; revision < 6; revision++) {
      // Spread small edits over separate days to respect the real anti-abuse rules.
      const priceChf = Math.round((offer.priceChf + revision / 10) * 100) / 100;
      await savePrice(secondInstance, { ...input, id: entry.id, revision, priceChf }, { beer, coffee }, 'test', Date.now() + revision * 86400001);
      const saved = (await store.read()).state.entries[0];
      expect(saved.revision).toBe(revision + 1);
      expect(saved.offer.priceChf).toBe(priceChf);
    }
    await Promise.all(['A', 'B'].map(name => savePrice(blobStore(path), { ...input, name, targetKey: undefined }, { beer, coffee }, name)));
    const state = (await secondInstance.read()).state;
    expect(state.entries).toHaveLength(3);
    expect(state.history).toHaveLength(5);
  } finally { await del(path); }
}, 60000);

it.skipIf(process.env.RUN_BLOB_INTEGRATION !== '1')('commits a scanned menu atomically and reuses its receipt across real store instances', async () => {
  const { reserveScan, saveMenuScan } = await import('../server/menu-scan-store');
  const { menuPrices } = await import('../server/menu-ocr');
  const path = `tests/menu-scan-${randomUUID()}.json`;
  const store = blobStore(path);
  const data = JSON.parse(await readFile('public/data/bars.json', 'utf8')) as Dataset;
  const bar = data.bars.find(b => b.id === 'node/582264861')!;
  const { prices, skipped } = menuPrices({ menu: true, wrongVenue: false, currency: 'CHF', rows: [
    { name: 'Sprint', category: 'beer', sizes: ['3dl', '5dl'], prices: ['5.20', '7.90'], beerType: 'draft', alcoholFree: false, clear: true },
  ] }, bar, '2026-10-16');
  try {
    await reserveScan(store, 'test-photo', 'integration-test');
    const saved = await saveMenuScan(store, 'test-photo', bar, [], prices, skipped);
    expect(saved.added).toBe(2);
    const repeated = await reserveScan(blobStore(path), 'test-photo', 'integration-test');
    expect(repeated?.entries.map(e => e.id)).toEqual(saved.entries.map(e => e.id));
    expect((await blobStore(path).read()).state.entries).toHaveLength(2);
  } finally { await del(path); }
}, 60000);
