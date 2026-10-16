import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { cities, isCity, cityStoragePath } from '../src/cities.js';
import { allVenues, InputError, zurichToday } from '../src/community.js';
import type { Dataset } from '../src/data.js';
import { blobStore } from '../server/prices.js';
import { menuPrices, readMenu, validateScanImage } from '../server/menu-ocr.js';
import { failScan, reserveScan, saveMenuScan } from '../server/menu-scan-store.js';

const MAX_BODY = 2_800_000;
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  let reserved: { store: ReturnType<typeof blobStore>; hash: string } | undefined;
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
    const data = body as { barId?: unknown; image?: unknown };
    const image = validateScanImage(data.image);
    const [beer, coffee, pizza, locations] = await Promise.all(['bars', 'coffee', 'pizza', 'locations'].map(name => readFile(`${process.cwd()}/public/data/${cities[city].data}${name}.json`, 'utf8').then(v => JSON.parse(v) as Dataset)));
    const bar = allVenues({ beer, coffee, pizza, locations }).find(b => b.id === data.barId);
    if (!bar) throw new InputError('Bitte zuerst ein Lokal auswählen.');
    const key = process.env.ANTHROPIC_API_KEY, secret = process.env.BLOB_READ_WRITE_TOKEN;
    if (!key || !secret) throw new InputError('Karte scannen ist gerade nicht verfügbar. Du kannst Preise einzeln eintragen.', 503);
    const store = blobStore(cityStoragePath(city, process.env.VERCEL_ENV === 'production'));
    const hash = createHash('sha256').update(`menu-v2:${city}:${bar.id}:`).update(Buffer.from(image.data, 'base64')).digest('hex');
    const visitor = createHmac('sha256', secret).update(`${zurichToday()}:${req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown'}`).digest('hex');
    const cached = await reserveScan(store, hash, visitor);
    if (cached) return reply(200, cached);
    reserved = { store, hash };
    const result = await readMenu(image, bar, key);
    const { prices, skipped } = menuPrices(result.parsed, bar, zurichToday());
    if (!prices.length) throw new InputError('Keine eindeutigen Bier-, Kaffee- oder Margherita-Preise erkannt. Bitte einen näheren, scharfen Ausschnitt fotografieren.', 422);
    const originals = [beer, coffee, pizza].flatMap(d => d.bars.find(b => b.id === bar.id)?.offers || []);
    const saved = await saveMenuScan(store, hash, bar, originals, prices, skipped);
    reserved = undefined;
    return reply(200, saved);
  } catch (error) {
    if (reserved) { try { await failScan(reserved.store, reserved.hash); } catch { /* Never replace the original error or log image/credentials. */ } }
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Menu scan failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Die Karte konnte gerade nicht gespeichert werden. Bitte später erneut versuchen.' });
  }
}
