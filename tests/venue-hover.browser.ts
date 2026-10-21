import { test, expect } from '@playwright/test';
import type { Bar, Offer } from '../src/data';

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  const offer: Offer = { name: 'Cappuccino', coffeeType: 'cappuccino', priceChf: 5, volumeMl: null,
    alcoholFree: true, confidence: 'reviewed', observedAt: '2026-10-20', sourceUrl: '', evidence: '' };
  const bars: Bar[] = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
    id: `hover-${index}`, name, type: 'cafe', lat: 47.378, lon: 8.535 + index * 0.001,
    address: 'Teststrasse', postcode: '8001', website: null, openingHours: null,
    outdoor: false, scrapeStatus: 'prices_found', checkedAt: null,
    offers: index === 2 ? [] : [{ ...offer, priceChf: 5 + index }],
  }));
  await page.route('**/data/*.json', route => route.fulfill({ json: {
    bars: route.request().url().endsWith('/coffee.json') ? bars : [],
    generatedAt: '', discoveredAt: '', attribution: '',
  } }));
  await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { counts: {} } }));
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`list hover and keyboard focus highlight the matching marker in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/?drink=coffee');
    const rows = page.locator('#results .venue');
    const alpha = page.locator('.marker-wrap[title^="Alpha:"]');
    const beta = page.locator('.marker-wrap[title^="Beta:"]');
    await expect(rows).toHaveCount(3);
    const normalZ = await alpha.evaluate(el => getComputedStyle(el).zIndex);
    const normalColor = await alpha.locator('.price-marker').evaluate(el => getComputedStyle(el).backgroundColor);
    const mapPosition = await alpha.getAttribute('style');
    const originalUrl = page.url();
    await rows.nth(0).locator('strong').hover();
    await expect(alpha).toHaveClass(/highlighted/);
    await expect(page.locator('.marker-wrap.highlighted')).toHaveCount(1);
    expect(Number(await alpha.evaluate(el => getComputedStyle(el).zIndex))).toBeGreaterThan(Number(normalZ));
    expect(await alpha.locator('.price-marker').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(normalColor);
    await rows.nth(0).locator('small').first().hover();
    await expect(alpha).toHaveClass(/highlighted/);
    await rows.nth(1).hover();
    await expect(alpha).not.toHaveClass(/highlighted/);
    await expect(beta).toHaveClass(/highlighted/);
    await page.locator('#search').hover();
    await expect(page.locator('.marker-wrap.highlighted')).toHaveCount(0);
    await expect(alpha).toHaveAttribute('style', mapPosition!);
    await expect(page.locator('#detail')).toBeHidden();
    expect(page.url()).toBe(originalUrl);

    await rows.nth(0).focus();
    await expect(alpha).toHaveClass(/highlighted/);
    await page.keyboard.press('Tab');
    await expect(beta).toHaveClass(/highlighted/);
    await expect(alpha).not.toHaveClass(/highlighted/);
    await page.locator('#search').focus();
    await expect(page.locator('.marker-wrap.highlighted')).toHaveCount(0);

    const gamma = page.locator('.marker-wrap[title^="Gamma:"]');
    await expect(gamma).toBeHidden();
    await rows.nth(2).hover();
    await expect(gamma).toBeVisible();
    await expect(gamma.locator('.venue-marker-name')).toBeVisible();
    await page.locator('#search').hover();
    await expect(gamma).toBeHidden();
  });
}

test.describe('touch-capable browser', () => {
test.use({ hasTouch: true });
test('hover preserves a selected venue and touch does not leave a highlight', async ({ page }) => {
  await page.goto('/?drink=coffee&bar=hover-0');
  const alpha = page.locator('.marker-wrap[title^="Alpha:"]');
  const beta = page.locator('.marker-wrap[title^="Beta:"]');
  const betaRow = page.locator('#results [data-bar="hover-1"]');
  await expect(alpha.locator('.price-marker')).toHaveClass(/active/);
  await betaRow.hover();
  await expect(beta).toHaveClass(/highlighted/);
  await expect(page.locator('#detail .detail-top')).toContainText('Alpha');
  await page.locator('#search').hover();
  await expect(beta).not.toHaveClass(/highlighted/);
  await expect(alpha.locator('.price-marker')).toHaveClass(/active/);
  await betaRow.dispatchEvent('pointerenter', { pointerType: 'touch' });
  await expect(beta).not.toHaveClass(/highlighted/);
  await betaRow.tap();
  await expect(page.locator('#detail .detail-top')).toContainText('Beta');
  await expect(beta.locator('.price-marker')).toHaveClass(/active/);
  await expect(page.locator('.marker-wrap.highlighted')).toHaveCount(0);
});
});
