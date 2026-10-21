import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`unpriced shared venue stays visible in the uncovered map at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.route('**/api/**', route => route.fulfill({ json: { entries: [], venues: [], venueCorrections: [], counts: {}, enabled: false } }));
    await page.goto('/?bar=node%2F5733725990');
    await expect(page.locator('#detail')).toContainText('ViCAFE Campus Rondell (UZH Hauptgebäude)');
    const marker = page.locator('.marker-wrap', { has: page.locator('.price-marker.active') });
    await expect(marker).toBeVisible();
    await expect(marker.locator('.venue-marker-name')).toBeVisible();
    await expect(page.locator('#map')).toHaveClass(/show-unpriced-markers/);
    const centered = async () => page.evaluate(() => {
      const map = document.querySelector('#map')!.getBoundingClientRect();
      const detail = document.querySelector('#detail')!.getBoundingClientRect();
      const pin = document.querySelector('.price-marker.active')!.getBoundingClientRect();
      const right = innerWidth > 760 ? detail.left : map.right;
      const bottom = innerWidth > 760 ? map.bottom : detail.top;
      return Math.abs(pin.x + pin.width / 2 - (map.left + right) / 2) < 4
        && Math.abs(pin.y + pin.height / 2 - (map.top + bottom) / 2) < 4;
    });
    await expect.poll(centered).toBe(true);
    // Zooming out must not hide the selected venue with the other unpriced dots.
    await page.locator('.leaflet-control-zoom-out').click();
    await expect(page.locator('#map')).not.toHaveClass(/show-unpriced-markers/);
    await expect(marker).toBeVisible();
    await expect(marker.locator('.venue-marker-name')).toBeVisible();
    await expect(page.locator('.unpriced-marker').filter({ hasNot: page.locator('.active') }).first()).toBeHidden();
    await page.locator('#close-detail').click();
    await expect(page.locator('.price-marker.active')).toHaveCount(0);
  });
}
