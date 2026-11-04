import { protectContribution, reservePhotoBudget } from '../server/community-security.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { cities, isCity, cityStoragePath, type City } from '../src/cities.js';
import { communityVenues, InputError, zurichToday } from '../src/community.js';
import { mergeStreetfood } from '../src/streetfood-selection.js';
import type { Bar, Dataset } from '../src/data.js';
import { blobStore } from '../server/prices.js';
import { MENU_SCAN_VERSION, OCR_BUDGET_USD, menuPrices, readMenu, validateScanImage, type ScanImage } from '../server/menu-ocr.js';
import { failedScanReason, keepFailedScan } from '../server/failed-scans.js';
import { failScan, parseScanEdit, reserveScan, resolveScanEdit, saveMenuScan, scanResult } from '../server/menu-scan-store.js';
import { priceOwner } from '../server/price-moderation.js';

const MAX_BODY = 2_800_000;
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  let reserved: { store: ReturnType<typeof blobStore>; hash: string } | undefined;
  // Once a valid photo has arrived, every later failure keeps it for review instead of showing an error.
  let photo: { city: City; image: ScanImage; store: ReturnType<typeof blobStore>; barId: unknown; bar?: Bar } | undefined;
  try {
    const city = new URL(req.url || '/', 'http://localhost').searchParams.get('city') || 'zurich';
    if (!isCity(city)) throw new InputError('Unbekannte Stadt.');
    let sameOrigin = false;
    try { sameOrigin = typeof req.headers.origin === 'string' && new URL(req.headers.origin).host === req.headers.host; } catch { /* invalid origin */ }
    if (!sameOrigin || req.headers['sec-fetch-site'] === 'cross-site') throw new InputError('Bitte den Scan auf dieser Website verwenden.', 403);
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON erwartet.', 415);
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw new InputError('Das Foto ist zu gross. Bitte einen kleineren Ausschnitt wählen.', 413);
    let body = req.body;
    if (body === undefined) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new InputError('Das Foto ist zu gross.', 413); chunks.push(Buffer.from(chunk)); }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new InputError('Ungültiger Upload.'); } }
    if (!body || typeof body !== 'object' || Buffer.byteLength(JSON.stringify(body)) > MAX_BODY) throw new InputError('Ungültiger Upload.');
    const data = body as { barId?: unknown; image?: unknown; edit?: unknown };
    const image = validateScanImage(data.image);
    photo = { city, image, store: blobStore(cityStoragePath(city, process.env.VERCEL_ENV === 'production')), barId: data.barId };
    await protectContribution(req, res, 'botToken' in body ? body.botToken : undefined, true);
    const [beer, coffee, pizza, locations] = await Promise.all(['bars', 'coffee', 'pizza', 'locations'].map(name => readFile(`${process.cwd()}/public/data/${cities[city].data}${name}.json`, 'utf8').then(v => JSON.parse(v) as Dataset)));
    const store = photo.store;
    const { state } = await store.read();
    // Scanned burger, ramen, kebab, cocktail and soft drink prices are matched against the scraped ones like beer and coffee.
    const [cocktail, softdrink, burger, ramen, doner, falafel] = await Promise.all(['gastro-cocktail', 'gastro-softdrink', 'burger', 'ramen', 'doner', 'falafel'].map(name => readFile(`${process.cwd()}/public/data/${cities[city].data}${name}.json`, 'utf8').then(v => JSON.parse(v) as Dataset, () => undefined)));
    const bar = communityVenues({ beer, coffee, pizza, locations, burger, ramen, kebab: mergeStreetfood([doner, falafel]) }, state.entries, state.venues, state.venueCorrections).find(b => b.id === data.barId);
    if (!bar) throw new InputError('Bitte zuerst ein Lokal auswählen.');
    photo.bar = bar;
    const originals = [beer, coffee, pizza, cocktail, softdrink, burger, ramen, doner, falafel].flatMap(d => d?.bars.find(b => b.id === bar.id)?.offers || []);
    const edit = data.edit === undefined ? undefined : parseScanEdit(data.edit);
    const key = process.env.ANTHROPIC_API_KEY, secret = process.env.BLOB_READ_WRITE_TOKEN;
    if (!key || !secret) throw new InputError('Karte scannen ist gerade nicht verfügbar. Du kannst Preise einzeln eintragen.', 503);
    const hash = createHash('sha256').update(`${MENU_SCAN_VERSION}:${city}:${bar.id}:${JSON.stringify(edit || null)}:`).update(Buffer.from(image.data, 'base64')).digest('hex');
    const previous = state.menuScans?.[hash];
    if (previous?.status === 'done' && previous.result && previous.expires > Date.now()) {
      return reply(200, scanResult(state, previous.result));
    }
    if (edit) resolveScanEdit(edit, bar, originals, state.entries);
    const visitor = createHmac('sha256', secret).update(`${zurichToday()}:${req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown'}`).digest('hex');
    const cached = await reserveScan(store, hash, visitor);
    if (cached) return reply(200, cached);
    reserved = { store, hash };
    await reservePhotoBudget(OCR_BUDGET_USD);
    const result = await readMenu(image, bar, key);
    const { prices, skipped } = menuPrices(result.parsed, bar, zurichToday());
    if (!prices.length) throw new InputError('Keine eindeutigen Preise erkannt. Bitte einen näheren, scharfen Ausschnitt fotografieren.', 422);
    const saved = await saveMenuScan(store, hash, bar, originals, prices, skipped, Date.now(), edit, priceOwner(req, res, true));
    reserved = undefined;
    return reply(200, saved);
  } catch (error) {
    if (reserved) { try { await failScan(reserved.store, reserved.hash); } catch { /* Never replace the original error or log image/credentials. */ } }
    const status = error instanceof InputError ? error.status : 503;
    const message = error instanceof InputError ? error.message : 'Unerwarteter Fehler';
    // The same photo is still being read in another request; that one finishes it.
    if (photo && status === 409 && /bereits verarbeitet/.test(message)) return reply(200, { queued: true, reason: 'busy', entries: [], added: 0, unchanged: 0, conflicts: 0, skipped: 0 });
    if (photo) {
      try {
        const kept = await keepFailedScan(photo.store, photo.city, photo.image, photo.bar, photo.barId, failedScanReason(status, message), message);
        console.warn('Menu photo kept for review', kept.reason);
        return reply(200, { queued: true, reason: kept.reason, entries: [], added: 0, unchanged: 0, conflicts: 0, skipped: 0 });
      } catch { /* Storage is down too: report the original problem below. */ }
    }
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Menu scan failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Die Karte konnte gerade nicht gespeichert werden. Bitte später erneut versuchen.' });
  }
}
