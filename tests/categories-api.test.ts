import { beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), record: vi.fn() }));
vi.mock('../server/category-popularity.js', async importOriginal => ({
  ...await importOriginal<typeof import('../server/category-popularity')>(),
  categoryStore: () => ({ read: mocks.read, write: mocks.write }),
  recordCategoryClick: mocks.record,
}));
import handler from '../api/categories';

async function request(method: string, body?: unknown, headers: Record<string, string> = {}, chunks?: string[]) {
  const req = Object.assign(Readable.from(chunks || []), { method, url: '/api/categories', body,
    headers: { host: 'example.org', origin: 'https://example.org', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
  let data: any;
  const res = { statusCode: 0, setHeader: vi.fn(), end: (text: string) => { data = JSON.parse(text); } } as unknown as ServerResponse;
  await handler(req, res);
  return { status: res.statusCode, data };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret');
  mocks.read.mockResolvedValue({ state: { days: {}, visitorDay: 'today', visitors: { private: ['coffee'] } } });
  mocks.record.mockResolvedValue({ coffee: 0, beer: 0, pizza: 0, doner: 1, falafel: 0 });
});
it('returns only aggregate counts and never visitor identifiers', async () => {
  expect((await request('GET')).data).toEqual({ counts: { coffee: 0, beer: 0, ramen: 0, burger: 0, pizza: 0, doner: 0, falafel: 0 } });
});
it('rejects foreign requests, invalid categories, methods and large bodies before recording', async () => {
  expect((await request('POST', { category: 'doner' }, { origin: 'https://other.org' })).status).toBe(403);
  expect((await request('POST', { category: 'doner' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await request('POST', { category: 'fake' })).status).toBe(400);
  expect((await request('POST', '{invalid')).status).toBe(400);
  expect((await request('POST', {}, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await request('POST', undefined, {}, [' '.repeat(513)])).status).toBe(413);
  expect((await request('DELETE')).status).toBe(405);
  expect(mocks.record).not.toHaveBeenCalled();
});
it('accepts all category clicks with a private daily hash, including streamed bodies', async () => {
  const result = await request('POST', undefined, {}, ['{"category":"doner"}']);
  expect(result.status).toBe(200);
  expect(mocks.record.mock.calls[0][1]).toBe('doner');
  expect(mocks.record.mock.calls[0][2]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result.data)).not.toContain('127.0.0.1');
});
it('fails gracefully when shared storage is unavailable', async () => {
  mocks.read.mockRejectedValue(new Error('offline'));
  expect((await request('GET')).status).toBe(503);
});
