import { test, expect } from '@playwright/test';
import { reviewHtml } from '../scripts/price-review.mjs';

test('filters the local review and opens the before/after details', async ({ page }) => {
  const offer = { name: 'Lager', priceChf: 6, volumeMl: 500, sourceUrl: 'https://example.org/menu', observedAt: '2026-10-19' };
  const row = { id: 'a', entryId: 'one', barId: 'node/1', city: 'zurich', drink: 'beer', venueName: 'Testbar', address: 'Teststrasse 1',
    revision: 1, updatedAt: '2026-10-19T10:00:00Z', before: { ...offer, priceChf: 7 }, after: offer, exact: true };
  await page.setContent(reviewHtml([row, { ...row, id: 'b', city: 'bern', drink: 'coffee', venueName: 'Kaffeebar', before: null,
    after: { ...offer, name: 'Espresso', volumeMl: null, coffeeType: 'espresso' } }], 'production'));
  const visibleRows = page.locator('tbody tr:visible');
  await expect(visibleRows).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Stadt', exact: true }).selectOption('bern');
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows).toContainText('Kaffeebar');
  await page.getByRole('combobox', { name: 'Kategorie', exact: true }).selectOption('beer');
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await page.getByLabel('Lokal / Angebot').fill('testbar');
  await expect(visibleRows).toHaveCount(1);
  await page.getByLabel('Ab Datum').fill('2026-10-20');
  await expect(visibleRows).toHaveCount(0);
  await page.getByLabel('Ab Datum').fill('2026-10-19');
  await page.getByRole('combobox', { name: 'Art', exact: true }).selectOption('Preis geändert');
  await expect(visibleRows).toHaveCount(1);
  await visibleRows.locator('summary').click();
  await expect(visibleRows.locator('pre').first()).toContainText('"priceChf": 7');
  await expect(visibleRows.locator('pre').last()).toContainText('"priceChf": 6');
  await expect(page.getByRole('link', { name: 'CSV · alle Einträge' })).toHaveAttribute('download', '');
});


test('shows all maps independently of price filters on mobile and desktop', async ({ page }) => {
  const maps = [
    { city: 'zurich' as const, map: { id: 'draft', name: 'Meine leere Map', createdAt: '2026-10-20T12:00:00Z', entries: [] } },
    { city: 'bern' as const, map: { id: 'approved', name: 'Günstige Glace', createdAt: '2026-10-19T12:00:00Z', entries: [],
      publication: { status: 'approved' as const, requestedAt: '2026-10-19', fingerprint: 'test' } } },
  ];
  await page.setContent(reviewHtml([], 'production', undefined, true, maps));
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const overview = page.locator('#map-overview');
    await expect(overview.getByRole('heading', { name: 'Alle erstellten Maps' })).toBeVisible();
    await expect(overview.locator('tbody tr')).toHaveCount(2);
    await expect(overview.locator('tbody tr').first()).toContainText('Meine leere Map');
    await expect(overview).toContainText('Nur per Link');
    await expect(overview).toContainText('Freigegeben');
    await expect(overview.getByRole('link', { name: 'Günstige Glace' })).toHaveAttribute('href', '/bern?map=approved');
    await page.getByLabel('Lokal / Angebot').fill('kein Treffer');
    await expect(overview.locator('tbody tr:visible')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/wobillig-review-overview-${width}.png`, fullPage: true });
  }
});
