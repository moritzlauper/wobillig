import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { del } from '@vercel/blob';
const target = vi.hoisted(() => ({ path: '' }));
vi.mock('../server/prices.js', async importOriginal => {
  const original = await importOriginal<typeof import('../server/prices')>();
  return { ...original, blobStore: () => original.blobStore(target.path) };
});
import handler from '../api/scan-menu';

it.skipIf(process.env.RUN_MENU_UPLOAD_LIVE !== '1')('runs the real upload handler, OCR, verification and Blob save with a temporary test key', async () => {
  target.path = `tests/menu-upload-${randomUUID()}.json`;
  const body = { barId: 'node/582264861', image: { mediaType: 'image/jpeg', data: readFileSync('tests/fixtures/menu-scan-table.jpg').toString('base64') } };
  async function upload() {
    const req = { method: 'POST', url: '/api/scan-menu?city=zurich', body, headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage & { body?: unknown };
    let data: any;
    const res = { statusCode: 0, setHeader() {}, end(value: string) { data = JSON.parse(value); } } as unknown as ServerResponse;
    await handler(req, res);
    expect(res.statusCode, JSON.stringify(data)).toBe(200);
    return data;
  }
  try {
    const saved = await upload(); expect(saved.added).toBe(10); expect(saved.entries).toHaveLength(10);
    expect(saved.entries.every((e: any) => e.offer.confidence === 'ai' && e.venue.name === 'Mars Bar')).toBe(true);
    const retry = await upload(); expect(retry.entries.map((e: any) => e.id)).toEqual(saved.entries.map((e: any) => e.id));
  } finally { await del(target.path); }
}, 90000);
