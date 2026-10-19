import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { cities, isCity, type City } from '../src/cities.js';
import type { Dataset } from '../src/data.js';
import { fetchGoogleRating, type GoogleRating } from '../server/google-rating.js';
import { cachedGoogleRating, googleRatingStore } from '../server/google-rating-cache.js';

const catalogues: Partial<Record<City, Dataset>> = {};
const pending = new Map<string, Promise<GoogleRating | null>>();
const limits = new Map<string, { count: number; until: number }>();
// An instance-local visitor guard supplements the shared monthly budget.
function allowed(ip: string): boolean {
  const now = Date.now();
  for (const [key, limit] of limits) if (limit.until <= now) limits.delete(key);
  const limit = limits.get(ip) || { count: 0, until: now + 60000 };
  if (limit.count >= 30 || (!limits.has(ip) && limits.size >= 1000)) return false;
  limit.count++;
  limits.set(ip, limit);
  return true;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return reply(405, {}); }
  try {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return reply(403, {});
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const city = params.get('city') || 'zurich';
    const id = params.get('bar');
    if (!isCity(city) || !id || id.length > 100) return reply(400, {});
    const data = catalogues[city] ||= JSON.parse(await readFile(`${process.cwd()}/public/data/${cities[city].data}pizza.json`, 'utf8')) as Dataset;
    const bar = data.bars.find(venue => venue.id === id);
    if (!bar) return reply(404, {});
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return reply(503, {});
    const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown');
    if (!allowed(ip)) { res.setHeader('Retry-After', '60'); return reply(429, {}); }
    const requestKey = `${city}:${id}`;
    let request = pending.get(requestKey);
    if (!request) {
      request = cachedGoogleRating(googleRatingStore(), requestKey, () => fetchGoogleRating(bar, cities[city].name, key))
        .finally(() => pending.delete(requestKey));
      pending.set(requestKey, request);
    }
    // All deployments share the durable seven-day cache and monthly budget.
    return reply(200, { rating: await request });
  } catch {
    return reply(503, {});
  }
}
