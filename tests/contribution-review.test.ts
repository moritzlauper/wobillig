import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyState, savePrice, saveVenue, WriteConflict, type Store } from '../server/prices';
import { saveVenueCorrection } from '../server/venue-corrections';
import { contributionReviewHtml, fingerprint, reviewContribution, claimLegacyMap } from '../server/contribution-review';
import { reserveScan, saveMenuScan } from '../server/menu-scan-store';
import type { Bar, Dataset } from '../src/data';
import type { PriceInput } from '../src/community';
const bar: Bar = { id: 'node/1', name: 'Test', address: 'Teststrasse 1', postcode: '8004', lat: 47.38, lon: 8.53, type: 'cafe', website: null, offers: [], openingHours: null, outdoor: false, checkedAt: null, scrapeStatus: 'unavailable' };
const dataset: Dataset = { bars: [bar], generatedAt: '', discoveredAt: '', attribution: '' };
const data = { beer: dataset, coffee: dataset };
const input: PriceInput = { barId: bar.id, drink: 'coffee', revision: 0, name: 'Espresso', priceChf: 4, volumeMl: null, coffeeType: 'espresso', alcoholFree: true, observedAt: '2026-10-21', sourceUrl: '' };
function memory(): Store { let state = emptyState(), version = 0; return { read: async () => ({ state: structuredClone(state), etag: String(version) }), write: async (next, etag) => { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; } }; }
let store: Store;
beforeEach(() => { store = memory(); vi.stubEnv('COMMUNITY_REVIEW_REQUIRED', 'true'); });
afterEach(() => vi.unstubAllEnvs());
it('holds plausible prices, rejects stale reviews and supports exact undo', async () => {
  const entry = await savePrice(store, input, data, 'visitor', Date.now(), 'owner');
  let state = (await store.read()).state;
  expect(state.entries).toEqual([]); expect(state.heldPrices).toHaveLength(1);
  const held = state.heldPrices![0];
  await expect(reviewContribution(store, 'price', entry.id, 'stale', 'approve', data)).rejects.toMatchObject({ status: 409 });
  await reviewContribution(store, 'price', entry.id, fingerprint(held), 'approve', data);
  state = (await store.read()).state; expect(state.entries[0].offer.priceChf).toBe(4); expect(state.heldPrices).toEqual([]);
  const undo = state.reviewUndo![0];
  await reviewContribution(store, 'undo', undo.id, fingerprint(undo), 'undo', data);
  expect((await store.read()).state.entries).toEqual([]);
  await expect(reviewContribution(store, 'undo', undo.id, fingerprint(undo), 'undo', data)).rejects.toMatchObject({ status: 409 });
});
it('does not overwrite newer public prices on approval or rollback', async () => {
  const entry = await savePrice(store, input, data, 'visitor');
  const { state, etag } = await store.read(); const held = state.heldPrices![0];
  state.entries.push({ ...entry, revision: 3 }); await store.write(state, etag);
  await expect(reviewContribution(store, 'price', entry.id, fingerprint(held), 'approve', data)).rejects.toMatchObject({ status: 409 });
  await reviewContribution(store, 'price', entry.id, fingerprint(held), 'reject', data);
  expect((await store.read()).state.entries[0].revision).toBe(3);
});
it('holds new venues and corrections, deduplicates and publishes only after approval', async () => {
  const added = await saveVenue(store, { ...bar, name: '<script>New</script>', website: '' }, data, 'zurich', 'v');
  expect(added.pending).toBe(true); let state = (await store.read()).state;
  expect(state.venues || []).toEqual([]); expect(state.pendingVenues).toHaveLength(1);
  const row = state.pendingVenues![0];
  expect(contributionReviewHtml([{ city: 'zurich', state }])).not.toContain('<script>New</script>');
  await reviewContribution(store, 'venue', row.id, fingerprint(row), 'approve', data);
  expect((await store.read()).state.venues).toHaveLength(1);
  const changed = await saveVenueCorrection(store, { barId: bar.id, revision: 0, changes: { website: 'https://example.org' } }, data, 'v');
  expect(changed.pending).toBe(true); state = (await store.read()).state;
  expect(state.venueCorrections || []).toEqual([]);
  const correction = state.pendingCorrections![0];
  await reviewContribution(store, 'correction', correction.id, fingerprint(correction), 'approve', data);
  expect((await store.read()).state.venueCorrections![0].changes.website).toBe('https://example.org/');
});
it('holds photo-derived prices as well as manual ones and does not publish them on retries', async () => {
  await reserveScan(store, 'hash', 'visitor');
  const result = await saveMenuScan(store, 'hash', bar, [], [{ input, evidence: 'menu' }], 0, Date.now(), undefined, 'owner');
  expect(result.pending).toBe(true); expect(result.entries).toEqual([]);
  expect((await store.read()).state.heldPrices).toHaveLength(1);
  const retry = await reserveScan(store, 'hash', 'visitor');
  expect(retry?.pending).toBe(true); expect(retry?.entries).toEqual([]);
});
it('assigns existing maps only explicitly and rejects stale or repeated claims', async () => {
  const { state, etag } = await store.read(); const map = { id: 'old', name: 'Legacy', entries: [], createdAt: '' }; state.customMaps = [map]; await store.write(state, etag);
  await claimLegacyMap(store, 'old', fingerprint(map), { browser: 'admin-browser' });
  expect((await store.read()).state.mapOwners!.old.browser).toBe('admin-browser');
  await expect(claimLegacyMap(store, 'old', fingerprint(map), { browser: 'other' })).rejects.toMatchObject({ status: 409 });
});
