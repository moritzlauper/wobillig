import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { emptyState, WriteConflict, type Store } from '../server/prices';

const mocks = vi.hoisted(() => ({ store: vi.fn(), send: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mocks.send, close: vi.fn() }) } }));
import prices from '../api/prices';
const id = 'd268dbea-93cf-45de-9d17-2b5c74090236';
const suggestion = { action: 'requestAutomaticMap', mapId: id, name: 'Coop Aktionen Zürich',
  sourceUrl: 'https://www.coop.ch/de/aktionen/alle-aktionen/c/m_1111', description: 'Kaffeeaktionen' };
beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret'); vi.stubEnv('VERCEL_ENV', 'production');
  for (const [key, value] of Object.entries({ SMTP_HOST: 'mail.example.org', SMTP_USER: 'hello@wobillig.ch', SMTP_PASSWORD: 'secret', COMMUNITY_EMAIL_FROM: 'Wobillig <hello@wobillig.ch>' })) vi.stubEnv(key, value);
  const stores = new Map<string, Store>();
  mocks.send.mockReset().mockResolvedValue({});
  mocks.store.mockReset().mockImplementation((path: string) => {
    if (!stores.has(path)) {
      let state = emptyState(), version = 0;
      stores.set(path, { read: async () => ({ state: structuredClone(state), etag: String(version) }), write: async (next, etag) => {
        if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++;
      } });
    }
    return stores.get(path);
  });
});
afterEach(() => vi.unstubAllEnvs());
async function request(body: object, cookie?: string) {
  const req = { method: 'POST', url: '/api/prices?city=bern', body,
    headers: { host: 'example.org', origin: 'https://example.org', cookie, 'content-type': 'application/json' }, socket: { remoteAddress: 'ip-1' } } as IncomingMessage & { body?: unknown };
  const headers: Record<string, any> = {}; let output = '';
  const res = { statusCode: 0, getHeader: (key: string) => headers[key], setHeader: (key: string, value: string) => { headers[key] = value; }, end: (value = '') => { output = value; } } as unknown as ServerResponse;
  await prices(req, res);
  const next = [headers['Set-Cookie']].flat().filter(Boolean).map((s: string) => s.split(';')[0]).join('; ');
  return { status: res.statusCode, data: JSON.parse(output), cookie: next || cookie };
}
const mail = (n = 0) => mocks.send.mock.calls[n][0];

it('mails hello@wobillig.ch once per new automatic map request', async () => {
  const first = await request(suggestion);
  expect(first.status).toBe(200);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mail()).toMatchObject({ to: 'hello@wobillig.ch', subject: 'Automatische Map angefragt: Coop Aktionen Zürich (Bern)' });
  expect(mail().text).toContain(suggestion.sourceUrl);
  expect(mail().text).toContain('#automatic-map-review');
  expect((await request(suggestion, first.cookie)).status).toBe(200);
  expect((await request({ ...suggestion, mapId: 'd268dbea-93cf-45de-9d17-2b5c74090237' }, first.cookie)).status).toBe(200);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it('mails publication requests but not plain map creation, and never fails the request', async () => {
  const barId = JSON.parse(readFileSync('public/data/bern/coffee.json', 'utf8')).bars[0].id;
  const created = await request({ action: 'createMap', mapId: id, name: 'Brot Bern' });
  expect(created.status).toBe(200);
  expect((await request({ action: 'saveMapEntry', mapId: id, barId, product: 'Brot', priceChf: 4.5, revision: 0 }, created.cookie)).status).toBe(200);
  expect(mocks.send).not.toHaveBeenCalled();
  mocks.send.mockRejectedValue(new Error('SMTP down'));
  const published = await request({ action: 'requestMapPublication', mapId: id }, created.cookie);
  expect(published.status).toBe(200);
  expect(published.data.map.publication.status).toBe('pending');
  expect(mail()).toMatchObject({ to: 'hello@wobillig.ch', subject: 'Map zur Veröffentlichung eingereicht: Brot Bern (Bern)' });
  expect(mail().text).toContain(`https://wobillig.ch/bern?map=${id}`);
  expect((await request({ action: 'requestMapPublication', mapId: id }, published.cookie)).status).toBe(200);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
