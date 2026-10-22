import { test, expect } from '@playwright/test';

// Explicit opt-in only: uses configured local Stripe sandbox, never live mode.
test('bank authentication completes a card tip without an email address', async ({ page, request }) => {
  test.skip(process.env.RUN_STRIPE_TIP_TEST !== '1', 'Requires a Stripe sandbox');
  test.setTimeout(90000);
  const quote = await (await request.get('/api/tip?city=zurich')).json();
  expect(quote.test).toBe(true);
  expect(quote.publishableKey).toMatch(/^pk_test_/);
  await page.goto('/');
  await page.locator('#tip-coffee').click();
  const payment = page.frameLocator('#tip-dialog iframe');
  await payment.getByRole('tab', { name: 'Karte', exact: true }).click({ timeout: 30000 });
  await payment.getByRole('textbox', { name: 'Kartennummer', exact: true }).fill('4000000000003220');
  await payment.getByRole('textbox', { name: /Ablaufdatum/ }).fill('1230');
  await payment.getByRole('textbox', { name: 'Sicherheitscode', exact: true }).fill('123');
  await expect(payment.locator('input[type=email]')).toHaveCount(0);
  await page.getByRole('button', { name: 'CHF 5.50 bezahlen', exact: true }).click();
  await expect.poll(() => page.frames().find(frame => /3d_secure_2.*test/.test(frame.url()))?.url(), { timeout: 30000 }).toBeTruthy();
  const bankFrame = page.frames().find(frame => /3d_secure_2.*test/.test(frame.url()))!;
  await bankFrame.getByRole('button', { name: /Complete/ }).click();
  await expect(page.locator('#tip-dialog')).toContainText('Danke für deinen Beitrag an die Plattformkosten!', { timeout: 30000 });
});
