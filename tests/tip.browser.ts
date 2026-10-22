import { test, expect } from '@playwright/test';

for (const [path, city, amount] of [['/', 'zurich', 550], ['/bern', 'bern', 500], ['/basel', 'basel', 530]] as const) {
  test(`small platform-cost contribution beside the contact link in ${city}`, async ({ page }) => {
    await page.route('**/api/prices?*', route => route.fulfill({ json: { entries: [] } }));
    const posts: string[] = [];
    await page.route('**/api/tip?*', route => {
      const request = route.request();
      if (request.method() === 'POST') {
        posts.push(request.url());
        return route.fulfill({ status: 503, json: {} });
      }
      expect(new URL(request.url()).searchParams.get('city')).toBe(city);
      return route.fulfill({ json: { enabled: true, amount, currency: 'chf', test: false, publishableKey: 'pk_test_public' } });
    });
    await page.goto(path);
    const tip = page.locator('#tip-coffee'), wish = page.getByRole('link', { name: 'Kontakt', exact: true });
    await expect(tip).toHaveText(`Plattformkosten stützen · CHF ${(amount / 100).toFixed(2)}`);
    await expect(tip).toHaveCSS('font-size', '10px');
    await expect(wish).toHaveCSS('font-size', '10px');
    const a = await tip.boundingBox(), b = await wish.boundingBox();
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
    await page.getByLabel('Kaffeesorte oder Matcha Latte').selectOption('espresso');
    await expect(tip).toHaveText(`Plattformkosten stützen · CHF ${(amount / 100).toFixed(2)}`);
    await tip.click();
    await expect(page.locator('#toast')).toContainText('Die Zahlung konnte nicht geöffnet werden.');
    await expect(tip).toBeEnabled();
    expect(posts).toHaveLength(1);
    expect(new URL(posts[0]).searchParams.get('amount')).toBe(String(amount));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

// A redirect must never copy a payment credential into map/share links.
test('removes Stripe return credentials while preserving map filters', async ({ page }) => {
  await page.route('**/api/tip?*', route => route.fulfill({ json: { enabled: false } }));
  await page.goto('/bern?coffeeType=espresso&payment_intent=pi_example&payment_intent_client_secret=pi_example_secret_private&redirect_status=succeeded');
  await expect(page).not.toHaveURL(/payment_intent|redirect_status|private/);
  expect(await page.evaluate(() => (window as any).goatcounter?.no_onload)).toBe(true);
  await expect(page.getByLabel('Kaffeesorte oder Matcha Latte')).toHaveValue('espresso');
  expect(await page.locator('a[href*="private"]').count()).toBe(0);
});

for (const kind of ['automatic', 'publication'] as const) {
  test(`optional contribution invitation follows successful ${kind} submission only`, async ({ page }) => {
    const mapId = 'd268dbea-93cf-45de-9d17-2b5c74090236';
    const map: any = { id: mapId, name: 'Test-Map', createdAt: new Date().toISOString(), entries: [{
      venue: { id: 'node/test', name: 'Test Café', address: 'Teststrasse 1', lat: 47.378, lon: 8.53 },
      product: 'Kaffee', priceChf: 5, revision: 1, updatedAt: new Date().toISOString(),
    }] };
    let fail = true, payments = 0;
    await page.route('**/api/tip?*', route => {
      if (route.request().method() === 'POST') { payments++; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { enabled: true, amount: 550, publishableKey: 'pk_test_public' } });
    });
    await page.route('**/api/prices?*', route => {
      if (route.request().method() === 'POST') {
        if (fail) return route.fulfill({ status: 503, json: { error: 'Testfehler' } });
        if (kind === 'automatic') map.automatic = { status: 'requested', sourceUrl: 'https://example.com', description: 'Kaffeeaktionen' };
        else map.publication = { status: 'pending', requestedAt: new Date().toISOString(), fingerprint: 'test' };
        return route.fulfill({ json: { map } });
      }
      return route.fulfill({ json: new URL(route.request().url()).searchParams.has('map') ? { map } : { entries: [] } });
    });
    await page.goto(kind === 'automatic' ? '/' : `/?map=${mapId}`);
    await expect(page.locator('#tip-coffee')).not.toHaveAttribute('hidden');
    if (kind === 'automatic') {
      await page.locator('#create-map').click();
      await page.getByLabel('Art der Map').selectOption('automatic');
      await page.getByLabel('Name der Map').fill('Test-Map');
      await page.getByLabel('Link zur Angebotsseite').fill('https://example.com');
      await page.getByLabel('Welche Angebote möchtest du sehen?').fill('Kaffeeaktionen');
    }
    const submit = kind === 'automatic' ? page.getByRole('button', { name: 'Anfrage einreichen', exact: true }) : page.locator('#map-publish');
    await submit.click();
    await expect(page.locator(kind === 'automatic' ? '#create-map-dialog [data-error]' : '#custom-map-action-error')).toBeVisible();
    await expect(page.locator('#tip-invitation')).toHaveCount(0);
    fail = false;
    await submit.click();
    const invite = page.locator('#tip-invitation');
    await expect(invite).toBeVisible();
    await expect(invite).toContainText('freiwillig');
    expect(payments).toBe(0);
    await invite.getByRole('button', { name: 'Nicht jetzt' }).click();
    await expect(invite).toHaveCount(0);
    await expect(page.locator('#custom-map-name')).toHaveText('Test-Map');
    await expect(page.locator(kind === 'automatic' ? '#custom-map-summary' : '#custom-map-visibility')).toContainText(kind === 'automatic' ? 'Anfrage eingereicht' : 'Zur Prüfung eingereicht');
    expect(payments).toBe(0);
  });
}
