import { cities, isCity, cityStoragePath, type City } from '../src/cities.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { communityVenues, validateInput, InputError } from '../src/community.js';
import type { Dataset } from '../src/data.js';
import { blobStore, savePrice, saveVenue } from '../server/prices.js';
import { coffeeRatingSummaries, saveCoffeeRating } from '../server/coffee-ratings.js';
import { priceOwner, visiblePrices } from '../server/price-moderation.js';
import { PriceCooldownError, withPriceCooldown } from '../server/price-cooldown.js';
import { isMapId } from '../src/custom-map-data.js';
import { saveCustomMap } from '../server/custom-maps.js';

const dataPromises: Partial<Record<City, Promise<Record<'beer' | 'coffee' | 'pizza' | 'locations', Dataset>>>> = {};
function datasets(city: City) {
  return dataPromises[city] ||= Promise.all(['bars', 'coffee', 'pizza', 'locations'].map(name => readFile(`${process.cwd()}/public/data/${cities[city].data}${name}.json`, 'utf8').then(JSON.parse)))
    .then(([beer, coffee, pizza, locations]) => ({ beer, coffee, pizza, locations }));
}
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  try {
    const city = new URL(req.url || '/', 'http://localhost').searchParams.get('city') || 'zurich';
    if (!isCity(city)) throw new InputError('Unbekannte Stadt.');
    const store = blobStore(cityStoragePath(city, process.env.VERCEL_ENV === 'production'));
    if (req.method === 'GET') {
      const { state } = await store.read();
      const mapId = new URL(req.url || '/', 'http://localhost').searchParams.get('map');
      if (mapId !== null) {
        if (!isMapId(mapId)) throw new InputError('Ungültige Map.');
        const map = state.customMaps?.find(item => item.id === mapId);
        if (!map) throw new InputError('Diese Map wurde nicht gefunden.', 404);
        return reply(200, { map });
      }
      return reply(200, { entries: visiblePrices(state, priceOwner(req, res)), venues: state.venues || [], coffeeRatings: coffeeRatingSummaries(state) });
    }
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== req.headers.host || req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { error: 'Bitte das Formular auf dieser Website verwenden.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'JSON erwartet.' });
    if (Number(req.headers['content-length'] || 0) > 8192) return reply(413, { error: 'Eintrag zu gross.' });
    let body = req.body;
    if (body === undefined) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new InputError('Eintrag zu gross.', 413); chunks.push(Buffer.from(chunk)); }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new InputError('Ungültiges JSON.'); } }
    if (JSON.stringify(body)?.length > 8192) throw new InputError('Eintrag zu gross.', 413);
    const data = await datasets(city);
    // Vercel overwrites this header. Only a daily salted hash is kept, never the IP address.
    const ip = req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const secret = process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) throw new Error('Missing storage secret');
    const visitor = createHmac('sha256', secret).update(`${new Date().toISOString().slice(0, 10)}:${ip}`).digest('hex');
    if (body && typeof body === 'object' && 'action' in body && (body.action === 'createMap' || body.action === 'saveMapEntry')) {
      return reply(200, { map: await saveCustomMap(store, body, data, visitor) });
    }
    if (body && typeof body === 'object' && 'action' in body && body.action === 'rateCoffee') {
      return reply(200, { rating: await saveCoffeeRating(store, body, data, city, visitor, secret) });
    }
    if (body && typeof body === 'object' && 'action' in body && body.action === 'addVenue') {
      return reply(200, await saveVenue(store, 'venue' in body ? body.venue : undefined, data, city, visitor));
    }
    const { state } = await store.read();
    const owner = priceOwner(req, res, true)!;
    const input = validateInput(body, communityVenues(data, visiblePrices(state, owner), state.venues));
    // A stable HMAC prevents a midnight reset; timestamps expire after ten minutes.
    const cooldownIp = createHmac('sha256', secret).update(`price-cooldown:${ip}`).digest('hex');
    const cooldownStore = blobStore(`prices/cooldowns/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`);
    const entry = await withPriceCooldown(cooldownStore, cooldownIp, owner,
      () => savePrice(store, input, data, visitor, Date.now(), owner));
    return reply(200, { entry });
  } catch (error) {
    if (error instanceof PriceCooldownError) {
      res.setHeader('Retry-After', String(error.retryAfter));
      return reply(429, { error: error.message, retryAfter: error.retryAfter });
    }
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Price storage failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Preise können gerade nicht gespeichert oder geladen werden. Bitte später erneut versuchen.' });
  }
}
