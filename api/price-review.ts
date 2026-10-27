import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { cities, cityStoragePath, type City } from '../src/cities.js';
import type { Dataset } from '../src/data.js';
import { blobStore } from '../server/prices.js';
import { reviewRows, reviewHtml, reviewCsv } from '../server/price-review.mjs';
import { authorizedMapReviewer, mapReviewCards } from '../server/map-review.js';
import { valueRatingOverview, valueRatingStore } from '../server/value-rating.js';

// Password-protected review area. Only price snapshots are exposed;
// raw state, visitor hashes, limits and scan receipts never leave this handler.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Preserve Origin on the embedded review forms without sending referrers to other sites.
  res.setHeader('Referrer-Policy', 'same-origin');
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
      const venues = catalogue.bars.map(bar => [`${city}:${bar.id}`, { name: bar.name, address: bar.address }] as const);
      return { prices: reviewRows(state, city, catalogue.bars), maps: (state.customMaps || []).map(map => ({ city, map })), venues };
    }));
    const rows = grouped.flatMap(group => group.prices).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision - a.revision);
    const maps = grouped.flatMap(group => group.maps);
    const venues = new Map(grouped.flatMap(group => group.venues));
    const valueRatings = valueRatingOverview((await valueRatingStore().read()).state, venues);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="price-changes.csv"');
    }
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : format === 'csv' ? reviewCsv(rows) : reviewHtml(rows, 'production', undefined, true, maps, mapReviewCards(maps), valueRatings));
  } catch (cause) {
    console.error('Price review failed', cause instanceof Error ? cause.name : 'UnknownError');
    return error(503, 'Die Preisübersicht konnte nicht vollständig geladen werden. Bitte die Seite später erneut öffnen.');
  }
}
