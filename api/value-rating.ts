import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { cities, isCity, type City } from '../src/cities.js';
import type { Dataset } from '../src/data.js';
import { readValueRating, removeValueRating, valueRatingStore, valueRatingVisitor, voteValueRating } from '../server/value-rating.js';

const catalogues: Partial<Record<City, Dataset>> = {};
const limits = new Map<string, { count: number; until: number }>();
// An instance-local guard. Votes are also limited per visitor and day in storage.
function allowed(ip: string): boolean {
  const now = Date.now();
  for (const [key, limit] of limits) if (limit.until <= now) limits.delete(key);
  const limit = limits.get(ip) || { count: 0, until: now + 60000 };
  if (limit.count >= 60 || (!limits.has(ip) && limits.size >= 1000)) return false;
  limit.count++;
  limits.set(ip, limit);
  return true;
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST, DELETE'); return reply(405, {}); }
  try {
    if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, {});
    const secret = process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) return reply(503, {});
    let city: string | null, bar: string | null, stars: unknown;
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (typeof origin !== 'string' || new URL(origin).host !== req.headers.host) return reply(403, {});
    }
    if (req.method === 'GET' || req.method === 'DELETE') {
      const params = new URL(req.url || '/', 'http://localhost').searchParams;
      city = params.get('city') || 'zurich';
      bar = params.get('bar');
    } else {
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, {});
      let body = req.body;
      if (body === undefined) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > 512) return reply(413, {});
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return reply(400, {}); } }
      const input = body as { city?: unknown; bar?: unknown; stars?: unknown } | null;
      if (!input || typeof input !== 'object') return reply(400, {});
      city = typeof input.city === 'string' ? input.city : null;
      bar = typeof input.bar === 'string' ? input.bar : null;
      stars = input.stars;
    }
    // Only venues from the city dataset can be rated. Unknown IDs are rejected before any storage call.
    if (!city || !isCity(city) || !bar || bar.length > 100) return reply(400, {});
    const data = catalogues[city] ||= JSON.parse(await readFile(`${process.cwd()}/public/data/${cities[city].data}locations.json`, 'utf8')) as Dataset;
    if (!data.bars.some(venue => venue.id === bar)) return reply(404, {});
    const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown');
    if (!allowed(ip)) { res.setHeader('Retry-After', '60'); return reply(429, {}); }
    const today = new Date().toISOString().slice(0, 10);
    const visitor = valueRatingVisitor(ip, today, secret);
    const key = `${city}:${bar}`;
    const store = valueRatingStore();
    if (req.method === 'GET') return reply(200, await readValueRating(store, key, visitor, today));
    // The emergency switch that pauses community writes also pauses these votes.
    if (process.env.COMMUNITY_WRITES_PAUSED === 'true') return reply(503, {});
    if (req.method === 'DELETE') return reply(200, await removeValueRating(store, key, visitor, today));
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) return reply(400, {});
    return reply(200, await voteValueRating(store, key, visitor, stars, today));
  } catch {
    return reply(503, {});
  }
}
