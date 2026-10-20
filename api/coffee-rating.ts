import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { cities, cityStoragePath, isCity } from '../src/cities.js';
import { communityVenues, InputError } from '../src/community.js';
import type { Dataset } from '../src/data.js';
import { blobStore } from '../server/prices.js';
import { browserIdentity } from '../server/browser-identity.js';
import { checkRatingChange, coffeeRatingSummaries, ratingVoter, saveCoffeeRating } from '../server/coffee-ratings.js';
import { reserveCoffeePhoto, verifyCoffeePhoto } from '../server/coffee-photo.js';
import { validateScanImage } from '../server/menu-ocr.js';

const MAX_BODY = 2_800_000;
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  try {
    const city = new URL(req.url || '/', 'http://localhost').searchParams.get('city') || 'zurich';
    if (!isCity(city)) throw new InputError('Unbekannte Stadt.');
    let sameOrigin = false;
    try { sameOrigin = typeof req.headers.origin === 'string' && new URL(req.headers.origin).host === req.headers.host; } catch { /* malformed origin */ }
    if (!sameOrigin || req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('Bitte das Formular auf dieser Website verwenden.', 403);
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON erwartet.', 415);
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw new InputError('Das Foto ist zu gross.', 413);
    let body = req.body;
    if (body === undefined) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length; if (size > MAX_BODY) throw new InputError('Das Foto ist zu gross.', 413);
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new InputError('Ungültiger Upload.'); } }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) throw new InputError('Ungültiger Upload.');
    const value = body as { barId?: unknown; score?: unknown; image?: unknown };
    if (typeof value.barId !== 'string' || value.barId.length > 100 || typeof value.score !== 'number' ||
        !Number.isInteger(value.score) || value.score < 1 || value.score > 5) throw new InputError('Bitte eine Bewertung von 1 bis 5 wählen.');
    const image = validateScanImage(value.image);
    const secret = process.env.BLOB_READ_WRITE_TOKEN, apiKey = process.env.ANTHROPIC_API_KEY;
    if (!secret || !apiKey) throw new InputError('Das Kaffeefoto kann gerade nicht geprüft werden. Bitte später erneut versuchen.', 503);
    const production = process.env.VERCEL_ENV === 'production';
    const store = blobStore(cityStoragePath(city, production));
    const [{ state }, ...catalogues] = await Promise.all([
      store.read(),
      ...['bars', 'coffee', 'pizza', 'locations'].map(name => readFile(`${process.cwd()}/public/data/${cities[city].data}${name}.json`, 'utf8').then(text => JSON.parse(text) as Dataset)),
    ] as const);
    const [beer, coffee, pizza, locations] = catalogues;
    const datasets = { beer, coffee, pizza, locations };
    const bar = communityVenues(datasets, state.entries, state.venues).find(item => item.id === value.barId);
    if (!bar) throw new InputError('Dieses Lokal ist nicht mehr verfügbar. Bitte neu laden.');
    const owner = browserIdentity(req, res, secret);
    const voter = ratingVoter(city, bar.id, owner, secret);
    const photoHash = createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex');
    const used = state.coffeePhotoUses?.[photoHash];
    if (used && (used.voter !== voter || used.barId !== bar.id)) throw new InputError('Dieses Foto wurde bereits für eine Bewertung verwendet. Bitte ein eigenes Kaffeefoto hochladen.', 422);
    checkRatingChange(state, bar.id, voter, value.score, Date.now());
    if (state.coffeeVotes?.[bar.id]?.[voter] === value.score && state.coffeeVoteDetails?.[bar.id]?.[voter]?.photoHash === photoHash) {
      return reply(200, { rating: coffeeRatingSummaries(state)[bar.id] });
    }
    const ip = createHmac('sha256', secret).update(`coffee-ip:${req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown'}`).digest('hex');
    await reserveCoffeePhoto(blobStore(`prices/coffee-photo-limits/${production ? 'production' : 'development'}.json`), ip, owner);
    await verifyCoffeePhoto(image, bar, apiKey);
    const rating = await saveCoffeeRating(store, value, datasets, city, ip, secret, Date.now(), { owner, photoHash });
    return reply(200, { rating });
  } catch (error) {
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Coffee rating failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Bewertung nicht gespeichert. Bitte erneut versuchen.' });
  }
}
