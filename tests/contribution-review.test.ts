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
beforeEach(() => { store = memory(); });
afterEach(() => vi.unstubAllEnvs());
// Older held rows can still sit in storage from before manual review was abolished.
async function seedHeld() {
  const { state, etag } = await store.read();
  const entry = { id: 'held-1', barId: bar.id, drink: 'coffee' as const, targetKey: '["espresso",null,"espresso",true]', revision: 1, updatedAt: '2026-10-21T12:00:00.000Z',
    offer: { name: 'Espresso', priceChf: 4, volumeMl: null, coffeeType: 'espresso' as const, alcoholFree: true, observedAt: '2026-10-21', sourceUrl: '', confidence: 'community' as const, evidence: '' }, venue: bar };
  state.heldPrices = [{ owner: 'owner', entry, reason: 'review-required', before: null, baseEntry: null }];
  await store.write(state, etag);
  return entry;
}
it('publishes normal prices, photo scans, venues and corrections directly', async () => {
  vi.stubEnv('COMMUNITY_REVIEW_REQUIRED', 'true');
  await savePrice(store, input, data, 'visitor');
  await reserveScan(store, 'photo', 'visitor');
  const scan = await saveMenuScan(store, 'photo', bar, [], [{ input: { ...input, name: 'Cappuccino', coffeeType: 'cappuccino' }, evidence: 'menu' }], 0);
  expect(scan.pending).not.toBe(true); expect(scan.entries).toHaveLength(1);
  const venue = await saveVenue(store, { ...bar, name: 'New cafe', website: '' }, data, 'zurich', 'visitor');
  expect(venue).not.toHaveProperty('pending');
  const correction = await saveVenueCorrection(store, { barId: bar.id, revision: 0, changes: { website: 'https://example.org' } }, data, 'visitor');
  expect(correction).not.toHaveProperty('pending');
  const { state } = await store.read();
  expect(state.entries).toHaveLength(2); expect(state.venues).toHaveLength(1); expect(state.venueCorrections).toHaveLength(1);
  expect(state.heldPrices || []).toEqual([]); expect(state.pendingVenues || []).toEqual([]); expect(state.pendingCorrections || []).toEqual([]);
});
it('refuses implausible prices instead of holding them', async () => {
  await expect(savePrice(store, { ...input, name: 'Cappuccino', coffeeType: 'cappuccino', priceChf: 22.5 }, data, 'visitor')).rejects.toMatchObject({ status: 400 });
  const { state } = await store.read();
  expect(state.entries).toEqual([]); expect(state.heldPrices || []).toEqual([]);
});
it('approves older held prices, rejects stale reviews and supports exact undo', async () => {
  const entry = await seedHeld();
  let state = (await store.read()).state;
  const held = state.heldPrices![0];
  await expect(reviewContribution(store, 'price', entry.id, 'stale', 'approve', data)).rejects.toMatchObject({ status: 409 });
  await reviewContribution(store, 'price', entry.id, fingerprint(held), 'approve', data);
  state = (await store.read()).state; expect(state.entries[0].offer.priceChf).toBe(4); expect(state.heldPrices).toEqual([]);
  const undo = state.reviewUndo![0];
  await reviewContribution(store, 'undo', undo.id, fingerprint(undo), 'undo', data);
  expect((await store.read()).state.entries).toEqual([]);
  await expect(reviewContribution(store, 'undo', undo.id, fingerprint(undo), 'undo', data)).rejects.toMatchObject({ status: 409 });
});
it('does not overwrite newer public prices on approval of an older held price', async () => {
  const entry = await seedHeld();
  const { state, etag } = await store.read(); const held = state.heldPrices![0];
  state.entries.push({ ...entry, revision: 3 }); await store.write(state, etag);
  await expect(reviewContribution(store, 'price', entry.id, fingerprint(held), 'approve', data)).rejects.toMatchObject({ status: 409 });
  await reviewContribution(store, 'price', entry.id, fingerprint(held), 'reject', data);
  expect((await store.read()).state.entries[0].revision).toBe(3);
});
it('escapes older pending venues on the review page', async () => {
  const state = emptyState();
  state.pendingVenues = [{ id: 'v1', venue: { ...bar, name: '<script>New</script>' }, submittedAt: '' }];
  expect(contributionReviewHtml([{ city: 'zurich', state }])).not.toContain('<script>New</script>');
});
it('assigns existing maps only explicitly and rejects stale or repeated claims', async () => {
  const { state, etag } = await store.read(); const map = { id: 'old', name: 'Legacy', entries: [], createdAt: '' }; state.customMaps = [map]; await store.write(state, etag);
  await claimLegacyMap(store, 'old', fingerprint(map), { browser: 'admin-browser' });
  expect((await store.read()).state.mapOwners!.old.browser).toBe('admin-browser');
  await expect(claimLegacyMap(store, 'old', fingerprint(map), { browser: 'other' })).rejects.toMatchObject({ status: 409 });
});
