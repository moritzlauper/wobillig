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
