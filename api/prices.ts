import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { allVenues, validateInput, InputError } from '../src/community.js';
import type { Dataset } from '../src/data.js';
import { blobStore, savePrice } from '../server/prices.js';

let dataPromise: Promise<Record<'beer' | 'coffee', Dataset>> | undefined;
function datasets() {
  return dataPromise ||= Promise.all(['bars', 'coffee'].map(name => readFile(`${process.cwd()}/public/data/${name}.json`, 'utf8').then(JSON.parse)))
    .then(([beer, coffee]) => ({ beer, coffee }));
}
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  try {
    const store = blobStore();
    if (req.method === 'GET') return reply(200, { entries: (await store.read()).state.entries });
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
    const data = await datasets();
    const input = validateInput(body, allVenues(data));
    // Vercel overwrites this header. Only a daily salted hash is kept, never the IP address.
    const ip = req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const secret = process.env.BLOB_READ_WRITE_TOKEN;
    if (!secret) throw new Error('Missing storage secret');
    const visitor = createHmac('sha256', secret).update(`${new Date().toISOString().slice(0, 10)}:${ip}`).digest('hex');
    const entry = await savePrice(store, input, data, visitor);
    return reply(200, { entry });
  } catch (error) {
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Price storage failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Preise können gerade nicht gespeichert oder geladen werden. Bitte später erneut versuchen.' });
  }
}
