import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import { isCategory } from '../src/categories.js';
import { categoryStore, popularityCounts, recordCategoryClick } from '../server/category-popularity.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return reply(405, {}); }
  try {
    if (req.method === 'GET') {
      const { state } = await categoryStore().read();
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
      return reply(200, { counts: popularityCounts(state) });
    }
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') return reply(403, {});
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, {});
    if (Number(req.headers['content-length'] || 0) > 512) return reply(413, {});
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
    if (JSON.stringify(body)?.length > 512) return reply(413, {});
    if (!body || typeof body !== 'object' || !('category' in body) || !isCategory(body.category)) return reply(400, {});
    const secret = process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) throw new Error('Missing category storage secret');
    // As with price contributions: daily, purpose-specific hash; no raw IP is stored.
    const ip = req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const visitor = createHmac('sha256', secret).update(`categories:${new Date().toISOString().slice(0, 10)}:${ip}`).digest('hex');
    return reply(200, { counts: await recordCategoryClick(categoryStore(), body.category, visitor) });
  } catch {
    return reply(503, {});
  }
}
