import { test, expect } from '@playwright/test';
import { dealPreviewHtml } from '../server/deal-review';

for (const width of [390, 1280]) test(`private promotion preview searches and expires offers at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.install({ time: new Date('2026-10-21T21:59:00Z') });
  const sourceUrl = 'https://epaper.coop.ch/test.pdf';
  const data = { revision: 1, fingerprint: 'a'.repeat(64), assignments: [], lastAttemptAt: '2026-10-21T10:00:00Z', lastSuccessAt: '2026-10-21T10:00:00Z', expiredCount: 0, upcomingCount: 0,
    batch: { source: { label: 'Testprospekt', scopeLabel: 'Ausgabe ungeprüft' }, branches: [{ id: 'node/1', chain: 'coop', name: 'Coop Test', address: 'Teststrasse 1', postcode: '8001', lat: 47.378, lon: 8.535, sourceUrl: 'https://www.openstreetmap.org/node/1' }], offers: [
      { id: 'sugar', chain: 'coop', product: 'Zucker', quantity: '10 kg', category: 'food', priceChf: 9, previousPriceChf: 18, priceBasis: 'pro Packung', conditions: 'Solange Vorrat', validFrom: '2026-10-15', validThrough: '2026-10-21', sourceUrl, sourcePage: 1, evidence: 'Zucker 9 statt 18' },
    ] } };
  await page.route('**/api/deals?view=preview', route => route.fulfill({ contentType: 'text/html', body: dealPreviewHtml(true) }));
  await page.route('**/api/deals', route => route.fulfill({ json: data }));
  await page.goto('/api/deals?view=preview');
  await expect(page.locator('header')).toContainText('NICHT VERÖFFENTLICHT');
  await expect(page.locator('#offers')).toContainText('Zucker');
  await expect(page.locator('#status')).toContainText('0 zugeordnete Filialen');
  await expect(page.locator('.deal-marker.candidate')).toHaveCount(1);
  await page.getByLabel('Produkt oder Marke').fill('Kaffee');
  await expect(page.locator('#offers .deal')).toHaveCount(0);
  await expect(page.locator('.deal-marker')).toHaveCount(0);
  await page.getByLabel('Produkt oder Marke').fill('zucker');
  await expect(page.locator('#offers .deal')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `/tmp/wobillig-deals-preview-${width}.png`, fullPage: true });
  await page.clock.fastForward(61000);
  await expect(page.locator('#offers .deal')).toHaveCount(0);
  await expect(page.locator('.deal-marker')).toHaveCount(0);
});
