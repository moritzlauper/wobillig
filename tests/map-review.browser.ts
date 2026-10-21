import { test, expect } from '@playwright/test';
import { mapReviewCards, mapReviewHtml } from '../server/map-review';
import mapReviewHandler from '../api/map-review';
import priceReviewHandler from '../api/price-review';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { reviewHtml } from '../server/price-review.mjs';
import { mapFingerprint } from '../server/custom-maps';
import type { CustomMap } from '../src/custom-map-data';

for (const combined of [true, false]) for (const decision of ['approve', 'reject'] as const) {
test(`${combined ? 'combined' : 'map'} review page submits ${decision} with the reviewed snapshot and a valid origin`, async ({ page }) => {
  const map: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Günstige Tampons', createdAt: '2026-10-20',
    publication: { status: 'pending', requestedAt: '2026-10-20', fingerprint: '' }, entries: Array.from({ length: 5 }, (_, i) => ({
      venue: { id: `node/${i + 1}`, name: ['Migros', 'Coop', 'Denner', 'Drogerie', 'Apotheke'][i], address: `Teststrasse ${i + 1}`, postcode: '8001', lat: 47.378, lon: 8.535 },
      product: 'Tampons, Packung mit 16 Stück', priceChf: 3.9 + i, revision: 1, updatedAt: '2026-10-20' })) };
  const maps = [{ city: 'zurich' as const, map }];
  const html = combined ? reviewHtml([], 'production', undefined, true, maps, mapReviewCards(maps)) : mapReviewHtml(maps);
  // Use the actual API's response policy: rendering only the HTML missed Origin: null on form POSTs.
  const headers: Record<string, string> = {};
  await (combined ? priceReviewHandler : mapReviewHandler)({ method: 'GET', headers: {} } as IncomingMessage,
    { setHeader(key: string, value: string) { headers[key] = value; }, end() {} } as unknown as ServerResponse);
  await page.route('**/review-preview', route => route.fulfill({ contentType: 'text/html', headers: { 'Referrer-Policy': headers['Referrer-Policy'] }, body: html }));
  let submitted = '';
  let origin: string | undefined;
  await page.route('**/api/map-review', route => { origin = route.request().headers().origin; submitted = route.request().postData()!; return route.fulfill({ body: 'Freigegeben' }); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/review-preview');
  await expect(page.getByRole('heading', { name: 'Maps zur Freigabe' })).toBeVisible();
  if (combined) {
    await expect(page.locator('#map-review tbody tr')).toHaveCount(5);
    await expect(page.getByRole('link', { name: 'Preisänderungen', exact: true })).toHaveAttribute('href', '#price-review');
    await expect(page.locator('#map-overview tbody tr')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Manuelle Preisänderungen' })).toBeVisible();
    await page.getByLabel('Lokal / Angebot').fill('no match');
    await expect(page.locator('#map-review tbody tr:visible')).toHaveCount(5);
  }
  await page.getByRole('button', { name: decision === 'approve' ? 'Freigeben und veröffentlichen' : 'Ablehnen', exact: true }).click();
  await expect.poll(() => new URLSearchParams(submitted).get('decision')).toBe(decision);
  expect(new URLSearchParams(submitted).get('fingerprint')).toBe(mapFingerprint(map));
  expect(origin).toBe(new URL(page.url()).origin);
});
}
