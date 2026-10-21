import { test, expect } from '@playwright/test';

test('legal pages work without JavaScript, link both languages and make no third-party requests', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 740 } });
  const page = await context.newPage();
  const external: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  for (const [path, title] of [['/impressum', 'Impressum'], ['/datenschutz', 'Datenschutz'], ['/en/imprint', 'Imprint'], ['/en/privacy', 'Privacy']]) {
    const response = await page.goto(`${baseURL}${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('address')).toContainText('Moritz Lauper');
    await expect(page.locator('address a[href="tel:+41797867307"]')).toHaveText('079 786 73 07');
    await expect(page.locator('main')).not.toContainText('Entwurf');
    await expect(page.locator('footer a')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (path === '/datenschutz') {
      await expect(page.locator('main')).toContainText('Konto-Schaltflächen sind vorerst ausgeblendet');
      await expect(page.locator('main')).toContainText('wobillig-account');
      await expect(page.locator('main')).toContainText('30 Tage');
      await expect(page.locator('main')).toContainText('sechsstelligen, zehn Minuten gültigen Code');
      await expect(page.locator('main')).toContainText('löscht keine Maps');
      await expect(page.locator('main')).toContainText('Betrag in CHF, die ausgewählte Stadt');
      await expect(page.locator('a[href="https://www.cloudflare.com/turnstile-privacy-policy/"]')).toHaveCount(1);
      await expect(page.locator('a[href="https://stripe.com/legal/dta"]')).toHaveCount(1);
      await expect(page.locator('main')).toContainText('GoatCounter');
      await page.screenshot({ path: '/tmp/wobillig-datenschutz-320.png', fullPage: true });
      await page.getByRole('link', { name: 'English', exact: true }).click();
      await expect(page).toHaveURL(/\/en\/privacy$/);
    }
    if (path === '/en/privacy') {
      await expect(page.locator('main')).toContainText('account buttons are temporarily hidden');
      await expect(page.locator('main')).toContainText('wobillig-account');
      await expect(page.locator('main')).toContainText('does not delete maps');
      await expect(page.locator('main')).toContainText('six-digit code');
    }
  }
  expect(external).toEqual([]);
  await page.goto(`${baseURL}/en/espresso-zuerich`);
  await expect(page.locator('.site-legal-footer').getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/en/privacy');
  await context.close();
});

test('legal links stay reachable at the page bottom in all mobile views without a duplicate map footer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/tip') return route.fulfill({ json: { enabled: false } });
    if (url.searchParams.has('map')) return route.fulfill({ json: { map: { id: url.searchParams.get('map'), name: 'Geteilte Map', canEdit: false, entries: [] } } });
    return route.fulfill({ json: { entries: [], venues: [], venueCorrections: [], counts: {} } });
  });
  const footer = page.locator('.site-legal-footer');
  const assertLinks = async () => {
    await expect(page.locator('.app-footer .legal-link')).toHaveCount(0);
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('link', { name: 'Impressum', exact: true })).toBeInViewport();
    await expect(footer.getByRole('link', { name: 'Datenschutz', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  await page.goto('/');
  await assertLinks();
  await page.locator('#view-list').click();
  await assertLinks();
  await page.locator('#results [data-bar]').first().click();
  await expect(page.locator('#detail')).toBeVisible();
  await assertLinks();
  await page.screenshot({ path: '/tmp/wobillig-footer-320.png' });
  await page.locator('#close-detail').click();
  await page.locator('#view-list').click();
  await assertLinks();
  await page.goto('/?map=d268dbea-93cf-45de-9d17-2b5c74090236');
  await expect(page.locator('#custom-map-name')).toHaveText('Geteilte Map');
  await assertLinks();
  await footer.getByRole('link', { name: 'Datenschutz', exact: true }).click();
  await expect(page).toHaveURL(/\/datenschutz$/);
});
