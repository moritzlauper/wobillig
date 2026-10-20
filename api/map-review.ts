import type { IncomingMessage, ServerResponse } from 'node:http';
import { cities, isCity, cityStoragePath, type City } from '../src/cities.js';
import { isMapId } from '../src/custom-map-data.js';
import { InputError } from '../src/community.js';
import { blobStore } from '../server/prices.js';
import { authorizedMapReviewer, mapReviewHtml, reviewMap } from '../server/map-review.js';
import { reviewAutomaticMap } from '../server/automatic-map-review.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
  const fail = (status: number, message: string) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(message); };
  if (!process.env.MAP_REVIEW_PASSWORD) return fail(503, 'Prüfzugang noch nicht eingerichtet.');
  if (!authorizedMapReviewer(req.headers.authorization)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Wobillig Map Review", charset="UTF-8"');
    return fail(401, 'Bitte mit dem Prüfzugang anmelden.');
  }
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return fail(405, 'Methode nicht erlaubt.'); }
  const store = (city: City) => blobStore(cityStoragePath(city, process.env.VERCEL_ENV === 'production'));
  try {
    if (req.method === 'POST') {
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') return fail(403, 'Bitte die Prüfseite auf dieser Website verwenden.');
      if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return fail(415, 'Formulardaten erwartet.');
      let body = req.body;
      if (body === undefined) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) return fail(413, 'Eintrag zu gross.'); chunks.push(Buffer.from(chunk)); }
        body = Buffer.concat(chunks).toString();
      }
      if (typeof body === 'string' && body.length > 4096) return fail(413, 'Eintrag zu gross.');
      const form = typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : body as Record<string, unknown>;
      if (form?.kind === 'automatic') {
        if (typeof form.city !== 'string' || !isCity(form.city) || !isMapId(form.id) ||
          !['reviewing', 'blocked', 'rejected'].includes(String(form.decision)) || typeof form.note !== 'string') return fail(400, 'Ungültige Entscheidung.');
        await reviewAutomaticMap(store(form.city), form.id, Number(form.revision), form.decision as 'reviewing' | 'blocked' | 'rejected', form.note);
        res.statusCode = 303; res.setHeader('Location', '/output/price-review/production#automatic-map-review'); res.end(); return;
      }
      if (!form || typeof form.city !== 'string' || !isCity(form.city) || !isMapId(form.id) || typeof form.fingerprint !== 'string'
        || !/^[a-f0-9]{64}$/.test(form.fingerprint) || !['approve', 'reject'].includes(String(form.decision))) return fail(400, 'Ungültige Entscheidung.');
      await reviewMap(store(form.city), form.id, form.fingerprint, form.decision === 'approve');
      res.statusCode = 303; res.setHeader('Location', '/output/price-review/production#map-review'); res.end(); return;
    }
    const rows = (await Promise.all((Object.keys(cities) as City[]).map(async city => {
      const { state } = await store(city).read();
      return (state.customMaps || []).filter(map => map.publication?.status === 'pending' || map.automatic).map(map => ({ city, map }));
    }))).flat().sort((a, b) => a.map.createdAt.localeCompare(b.map.createdAt));
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(mapReviewHtml(rows));
  } catch (error) {
    if (error instanceof InputError) return fail(error.status, error.message);
    console.error('Map review failed', error instanceof Error ? error.name : 'UnknownError');
    fail(503, 'Die Prüfseite konnte nicht vollständig geladen werden. Bitte erneut versuchen.');
  }
}
