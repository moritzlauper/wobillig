import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), blobStore: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../server/prices.js', () => ({ blobStore: mocks.blobStore }));
import handler from '../api/price-review';

const offer = { name: 'Lager', priceChf: 7, volumeMl: 500, observedAt: '2026-10-19', sourceUrl: '', alcoholFree: false };
function state(path: string) {
  return { entries: [], history: [], limits: { 'private-visitor-hash': { count: 5 } }, menuScans: { 'private-scan-hash': {} },
    priceChanges: [{ id: path, entryId: path, revision: 1, updatedAt: '2026-10-19T10:00:00Z',
      barId: 'node/1', venueName: path.includes('bern') ? 'Berner Bar' : path.includes('basel') ? 'Basler Bar' : 'Zürcher Bar',
      address: 'Teststrasse 1', drink: 'beer', source: 'manual', before: { ...offer, priceChf: 8 }, after: offer }] };
}
async function request(url = '/output/price-review/production', method = 'GET', authorized = true) {
  const headers: Record<string, string> = {};
  let body = '';
  const req = { url, method, headers: { authorization: authorized ? 'Basic ' + Buffer.from('admin:review-secret').toString('base64') : undefined } } as IncomingMessage;
  const res = { statusCode: 0, setHeader: (key: string, value: string) => { headers[key] = value; },
    end: (value?: string) => { body = value || ''; } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, headers, body };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MAP_REVIEW_PASSWORD', 'review-secret');
  mocks.readFile.mockResolvedValue(JSON.stringify({ bars: [] }));
  mocks.blobStore.mockImplementation((path: string) => ({ read: async () => ({ state: state(path) }) }));
});

afterEach(() => vi.unstubAllEnvs());

describe('online manual price review', () => {
  it('loads all production stores afresh and renders only price snapshots', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.blobStore.mock.calls.map(([path]) => path)).toEqual(['prices/production.json', 'prices/bern/production.json', 'prices/basel/production.json', 'prices/lausanne/production.json', 'prices/geneva/production.json']);
    for (const name of ['Zürcher Bar', 'Berner Bar', 'Basler Bar']) expect(response.body).toContain(name);
    expect(response.body).not.toContain('private-visitor-hash');
    expect(response.body).not.toContain('private-scan-hash');
    expect(response.body).not.toContain('npm run');
    expect(response.body).toContain('Jetzt aktualisieren');
    expect(response.body).toContain('href="/output/price-review/production?format=csv"');
    expect(response.headers['Cache-Control']).toContain('no-store');
    expect(response.headers['X-Robots-Tag']).toContain('noindex');
    await request();
    expect(mocks.blobStore).toHaveBeenCalledTimes(10);
  });
  it('shows all maps across cities, including empty drafts and every publication status', async () => {
    mocks.blobStore.mockImplementation((path: string) => ({ read: async () => ({ state: { ...state(path), customMaps:
      [undefined, 'pending', 'approved', 'rejected'].map((status, i) => ({ id: `map-${i}`, name: `${path} <Map ${i}>`,
        createdAt: `2026-10-${10 + i}T10:00:00Z`, entries: [], publication: status ? { status } : undefined })) } }) }));
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.body).toContain('20 Maps in allen Städten');
    for (const status of ['Nur per Link', 'Zur Prüfung eingereicht', 'Freigegeben', 'Abgelehnt']) expect(response.body).toContain(status);
    for (const path of ['/?map=map-0', '/bern?map=map-0', '/basel?map=map-0', '/lausanne?map=map-0', '/genf?map=map-0']) expect(response.body).toContain(`href="${path}"`);
    expect(response.body).toContain('&lt;Map 0&gt;');
    expect(response.body.match(/action="\/api\/map-review"/g)).toHaveLength(5);
    expect(response.body).toContain('href="#map-review"');
    expect((await request('/output/price-review/production?view=maps')).body).toContain('Alle erstellten Maps');
    expect(response.body).not.toContain('<Map 0>');
    vi.clearAllMocks();
    const denied = await request(undefined, undefined, false);
    expect(denied.status).toBe(401);
    expect(denied.body).not.toContain('Map 0');
    expect(mocks.blobStore).not.toHaveBeenCalled();
  });
  it('exports current CSV with no private visitor data', async () => {
    const response = await request('/api/price-review?format=csv');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['Content-Disposition']).toContain('price-changes.csv');
    expect(response.body).toContain('Berner Bar');
    expect(response.body).not.toContain('private-visitor-hash');
    expect(response.headers['X-Robots-Tag']).toContain('noindex');
  });
  it('returns an error rather than a partial report when a city cannot load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.blobStore.mockImplementation((path: string) => ({ read: async () => {
      if (path.includes('bern')) throw new Error('Storage unavailable');
      return { state: state(path) };
    } }));
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.body).not.toContain('Zürcher Bar');
    log.mockRestore();
  });
  it('supports HEAD without a body and rejects writes and unsupported formats', async () => {
    expect(await request('/api/price-review', 'HEAD')).toMatchObject({ status: 200, body: '' });
    vi.clearAllMocks();
    expect((await request('/api/price-review', 'POST')).status).toBe(405);
    expect((await request('/api/price-review?format=raw')).status).toBe(400);
    expect(mocks.blobStore).not.toHaveBeenCalled();
  });
});
