import type { IncomingMessage, ServerResponse } from 'node:http';
import { isCity } from '../src/cities.js';
import { cappuccinoTipAmount, tipPaymentParams } from '../server/tips.js';

const limits = new Map<string, { count: number; until: number }>();
function allowed(ip: string): boolean {
  const now = Date.now();
  for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
  const value = limits.get(ip) || { count: 0, until: now + 60000 };
  if (value.count >= 10 || (!limits.has(ip) && limits.size >= 1000)) return false;
  value.count++; limits.set(ip, value); return true;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return reply(405, {}); }
  try {
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const city = params.get('city') || 'zurich', locale = params.get('locale') || 'de';
    if (!isCity(city) || !['de', 'en'].includes(locale)) return reply(400, {});
    const key = process.env.STRIPE_SECRET_KEY;
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    const configured = publishableKey && /^pk_(test|live)_/.test(publishableKey)
      && publishableKey.split('_')[1] === key?.split('_')[1] && key && /^(sk|rk)_(test|live)_/.test(key)
      && (process.env.VERCEL_ENV !== 'production' || /^(sk|rk)_live_/.test(key));
    if (!configured) return reply(req.method === 'GET' ? 200 : 503, { enabled: false });
    if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, {});
    if (req.method === 'POST') {
      if (typeof req.headers.origin !== 'string' || new URL(req.headers.origin).host !== req.headers.host) return reply(403, {});
      const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown');
      if (!allowed(ip)) { res.setHeader('Retry-After', '60'); return reply(429, {}); }
    }
    const amount = await cappuccinoTipAmount(city);
    if (req.method === 'GET') return reply(200, { enabled: true, amount, currency: 'chf', publishableKey, test: key!.includes('_test_') });
    // Never silently charge a different amount from the one the visitor saw.
    if (params.get('amount') !== String(amount)) return reply(409, { amount });
    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tipPaymentParams(city, amount),
      signal: AbortSignal.timeout(15000),
    });
    const intent = await response.json() as { client_secret?: string };
    if (!response.ok || !intent.client_secret || !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(intent.client_secret)) return reply(502, {});
    return reply(200, { clientSecret: intent.client_secret });
  } catch { return reply(503, {}); }
}
