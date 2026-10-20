import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { cities, cityStoragePath, type City } from '../src/cities.js';
import type { Dataset } from '../src/data.js';
import { blobStore } from '../server/prices.js';
import { reviewRows, reviewHtml, reviewCsv } from '../server/price-review.mjs';
import { authorizedMapReviewer } from '../server/map-review.js';
import mapReview from './map-review.js';

// Password-protected review area. Only price snapshots are exposed;
// raw state, visitor hashes, limits and scan receipts never leave this handler.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const error = (status: number, message: string) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(req.method === 'HEAD' ? undefined : message);
  };
  if (!process.env.MAP_REVIEW_PASSWORD) return error(503, 'Prüfzugang noch nicht eingerichtet.');
  if (!authorizedMapReviewer(req.headers.authorization)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Wobillig Map Review", charset="UTF-8"');
    return error(401, 'Bitte mit dem Prüfzugang anmelden.');
  }
  if (new URL(req.url || '/', 'http://localhost').searchParams.get('view') === 'maps') return mapReview(req, res);
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, HEAD');
    return error(405, 'Methode nicht erlaubt.');
  }
  const format = new URL(req.url || '/', 'http://localhost').searchParams.get('format') || 'html';
  if (!['html', 'csv'].includes(format)) return error(400, 'Unbekanntes Format.');
  try {
    const grouped = await Promise.all((Object.keys(cities) as City[]).map(async city => {
      const [{ state }, catalogue] = await Promise.all([
        blobStore(cityStoragePath(city, true)).read(),
        readFile(`${process.cwd()}/public/data/${cities[city].data}locations.json`, 'utf8').then(text => JSON.parse(text) as Dataset),
      ]);
      return reviewRows(state, city, catalogue.bars);
    }));
    const rows = grouped.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="price-changes.csv"');
    }
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : format === 'csv' ? reviewCsv(rows) : reviewHtml(rows, 'production', undefined, true));
  } catch (cause) {
    console.error('Price review failed', cause instanceof Error ? cause.name : 'UnknownError');
    return error(503, 'Die Preisübersicht konnte nicht vollständig geladen werden. Bitte die Seite später erneut öffnen.');
  }
}
