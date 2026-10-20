import type { IncomingMessage, ServerResponse } from 'node:http';
import { authorizedMapReviewer } from '../server/map-review.js';
import { blobStore } from '../server/prices.js';
import { assignDeal, emptyDealPilot } from '../server/deals.js';
import { visibleDealPreview } from '../src/deal-data.js';
import { InputError } from '../src/community.js';
import { dealPreviewHtml } from '../server/deal-review.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0'); res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
  const reply = (status: number, data: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); };
  if (!process.env.MAP_REVIEW_PASSWORD) return reply(503, { error: 'Prüfzugang noch nicht eingerichtet.' });
  if (!authorizedMapReviewer(req.headers.authorization)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Wobillig Map Review", charset="UTF-8"');
    return reply(401, { error: 'Bitte mit dem Prüfzugang anmelden.' });
  }
  if (!['GET', 'HEAD', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, HEAD, POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && new URL(req.url || '/', 'http://localhost').searchParams.get('view') === 'preview') {
      res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(req.method === 'HEAD' ? undefined : dealPreviewHtml(!process.env.VERCEL && process.env.NODE_ENV !== 'production'));
    }
    const store = blobStore(`deals/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`);
    if (req.method === 'POST') {
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Bitte die Prüfseite auf dieser Website verwenden.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'JSON erwartet.' });
      let body = req.body;
      if (body === undefined) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new InputError('Eintrag zu gross.', 413); chunks.push(Buffer.from(chunk)); }
        body = Buffer.concat(chunks).toString();
      }
      if (typeof body === 'string') { if (body.length > 8192) throw new InputError('Eintrag zu gross.', 413); try { body = JSON.parse(body); } catch { throw new InputError('Ungültiges JSON.'); } }
      if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 8192) throw new InputError('Ungültige Filialzuordnung.');
      return reply(200, visibleDealPreview(await assignDeal(store, body as Record<string, unknown>)));
    }
    const { state } = await store.read();
    return reply(200, visibleDealPreview(state.dealPilot || emptyDealPilot()));
  } catch (error) {
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Private deal preview failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Die Aktionsvorschau konnte nicht geladen werden. Bitte erneut versuchen.' });
  }
}
