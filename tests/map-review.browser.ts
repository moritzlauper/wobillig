import { test, expect } from '@playwright/test';
import { mapReviewHtml } from '../server/map-review';
import { mapFingerprint } from '../server/custom-maps';
import type { CustomMap } from '../src/custom-map-data';

test('review page shows all submitted products and submits the reviewed snapshot', async ({ page }) => {
  const map: CustomMap = { id: 'd268dbea-93cf-45de-9d17-2b5c74090236', name: 'Günstige Tampons', createdAt: '2026-10-20',
    publication: { status: 'pending', requestedAt: '2026-10-20', fingerprint: '' }, entries: Array.from({ length: 5 }, (_, i) => ({
      venue: { id: `node/${i + 1}`, name: ['Migros', 'Coop', 'Denner', 'Drogerie', 'Apotheke'][i], address: `Teststrasse ${i + 1}`, postcode: '8001', lat: 47.378, lon: 8.535 },
      product: 'Tampons, Packung mit 16 Stück', priceChf: 3.9 + i, revision: 1, updatedAt: '2026-10-20' })) };
  const html = mapReviewHtml([{ city: 'zurich', map }]);
  await page.route('**/review-preview', route => route.fulfill({ contentType: 'text/html', body: html }));
  let submitted = '';
  await page.route('**/api/map-review', route => { submitted = route.request().postData()!; return route.fulfill({ body: 'Freigegeben' }); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/review-preview');
  await expect(page.getByRole('heading', { name: 'Maps zur Freigabe' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Preisänderungen', exact: true })).toHaveAttribute('href', '/output/price-review/production');
  await page.screenshot({ path: '/tmp/wobillig-map-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Freigeben und veröffentlichen' }).click();
  await expect.poll(() => new URLSearchParams(submitted).get('decision')).toBe('approve');
  expect(new URLSearchParams(submitted).get('fingerprint')).toBe(mapFingerprint(map));
});
