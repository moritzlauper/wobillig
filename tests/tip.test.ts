import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../api/tip';
import { cappuccinoTipAmount, tipPaymentParams } from '../server/tips';

let visitor = 0;
async function request(query = 'city=zurich&amount=550', method = 'POST', headers: Record<string, string> = {}, ip = String(++visitor)) {
  const req = Object.assign(Readable.from([]), { method, url: `/api/tip?${query}`,
    headers: { host: 'wobillig.ch', origin: 'https://wobillig.ch', ...headers }, socket: { remoteAddress: ip } }) as unknown as IncomingMessage;
  let data: any;
  const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { data = JSON.parse(value); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data };
}
beforeEach(() => { vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_private'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_public'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('uses each city’s affordable cappuccino amount in cents', async () => {
  expect(await cappuccinoTipAmount('zurich')).toBe(550);
  expect(await cappuccinoTipAmount('bern')).toBe(520);
  expect(await cappuccinoTipAmount('basel')).toBe(550);
});
it('keeps branding and product metadata specific to wobillig, with no subscription', () => {
  const params = tipPaymentParams('bern', 500);
  expect(params.get('amount')).toBe('500');
  expect(params.get('currency')).toBe('chf');
  expect(params.get('description')).toBe('wobillig – Cappuccino – Bern');
  expect(params.get('metadata[product]')).toBe('wobillig_tip');
  expect(params.has('receipt_email')).toBe(false);
  expect(params.has('customer')).toBe(false);
  expect(params.get('payment_method_types[0]')).toBe('twint');
});
it('quotes amounts without creating payments, and hides unavailable or production test checkouts', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await request('city=basel', 'GET')).data).toEqual({ enabled: true, amount: 550, currency: 'chf', test: true, publishableKey: 'pk_test_public' });
  vi.stubEnv('VERCEL_ENV', 'production');
  expect((await request('', 'GET')).data).toEqual({ enabled: false });
  expect((await request()).status).toBe(503);
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  expect((await request('', 'GET')).data).toEqual({ enabled: false });
  expect(fetcher).not.toHaveBeenCalled();
});
it('hides payments when public and secret keys belong to different modes', async () => {
  vi.stubEnv('STRIPE_PUBLISHABLE_KEY', 'pk_live_public');
  expect((await request('', 'GET')).data).toEqual({ enabled: false });
  expect((await request()).status).toBe(503);
});
it('rejects tampered amounts, cities, locales and foreign requests before contacting Stripe', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await request('city=zurich&amount=1')).status).toBe(409);
  expect((await request('city=bogus&amount=550')).status).toBe(400);
  expect((await request('city=zurich&locale=bogus&amount=550')).status).toBe(400);
  expect((await request(undefined, 'POST', { origin: 'https://other.org' })).status).toBe(403);
  expect((await request(undefined, 'POST', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await request(undefined, 'DELETE')).status).toBe(405);
  expect(fetcher).not.toHaveBeenCalled();
});
it('creates a server-priced PaymentIntent and rejects malformed responses and Stripe failures', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ client_secret: 'pi_example_secret_example' })));
  vi.stubGlobal('fetch', fetcher);
  expect((await request()).status).toBe(200);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.stripe.com/v1/payment_intents');
  expect(options.body.get('amount')).toBe('550');
  fetcher.mockResolvedValue(new Response(JSON.stringify({ url: 'https://evil.example/' })));
  expect((await request()).status).toBe(502);
  fetcher.mockRejectedValue(new Error('sk_test_private'));
  const result = await request();
  expect(result.status).toBe(503);
  expect(JSON.stringify(result.data)).not.toContain('private');
});
it('limits payment creation per visitor', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ client_secret: 'pi_example_secret_example' })))));
  for (let n = 0; n < 10; n++) expect((await request(undefined, 'POST', {}, 'limited')).status).toBe(200);
  expect((await request(undefined, 'POST', {}, 'limited')).status).toBe(429);
});
