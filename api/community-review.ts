import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { cities, isCity, cityStoragePath, type City } from '../src/cities.js';
import { InputError } from '../src/community.js';
import { blobStore } from '../server/prices.js';
import { authorizedMapReviewer } from '../server/map-review.js';
import { actorFor, sameOrigin } from '../server/community-security.js';
import { claimLegacyMap, contributionReviewHtml, reviewContribution } from '../server/contribution-review.js';
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
  const fail = (status: number, message: string) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(message); };
  if (!process.env.MAP_REVIEW_PASSWORD) return fail(503, 'Prüfzugang nicht eingerichtet.');
  if (!authorizedMapReviewer(req.headers.authorization)) { res.setHeader('WWW-Authenticate', 'Basic realm="Wobillig Map Review", charset="UTF-8"'); return fail(401, 'Bitte anmelden.'); }
  const store = (city: City) => blobStore(cityStoragePath(city, process.env.VERCEL_ENV === 'production'));
  try {
    if (req.method === 'POST') {
      if (!sameOrigin(req)) throw new InputError('Bitte die Prüfseite verwenden.', 403);
      if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw new InputError('Formulardaten erwartet.', 415);
      let body = req.body;
      if (Number(req.headers['content-length'] || 0) > 4096) throw new InputError('Eintrag zu gross.', 413);
      if (body === undefined) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new InputError('Eintrag zu gross.', 413); chunks.push(Buffer.from(chunk)); } body = Buffer.concat(chunks).toString(); }
      if (JSON.stringify(body)?.length > 4096) throw new InputError('Eintrag zu gross.', 413);
      const form = typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : body as Record<string, unknown>;
      if (!form || typeof form.city !== 'string' || !isCity(form.city) || typeof form.id !== 'string' || typeof form.kind !== 'string' || typeof form.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(form.fingerprint) || typeof form.decision !== 'string') throw new InputError('Ungültige Entscheidung.');
      const city = form.city;
      if (form.kind === 'legacy-map' && form.decision === 'claim') {
        await claimLegacyMap(store(city), form.id, form.fingerprint, actorFor(req, res));
        res.statusCode = 303; res.setHeader('Location', '/api/community-review'); res.end(); return;
      }
      const [beer, coffee, pizza] = await Promise.all(['bars', 'coffee', 'pizza'].map(name => readFile(`${process.cwd()}/public/data/${cities[city].data}${name}.json`, 'utf8').then(JSON.parse)));
      await reviewContribution(store(city), form.kind, form.id, form.fingerprint, form.decision, { beer, coffee, pizza });
      res.statusCode = 303; res.setHeader('Location', '/api/community-review'); res.end(); return;
    }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return fail(405, 'Methode nicht erlaubt.'); }
    const groups = await Promise.all((Object.keys(cities) as City[]).map(async city => ({ city, state: (await store(city).read()).state })));
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(contributionReviewHtml(groups));
  } catch (error) { if (error instanceof InputError) return fail(error.status, error.message); return fail(503, 'Beiträge konnten nicht geladen werden.'); }
}
