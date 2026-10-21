import { expect, it, vi } from 'vitest';
import type { Bar } from '../src/data';
import { reserveCoffeePhoto, verifyCoffeePhoto } from '../server/coffee-photo';
import { emptyState, WriteConflict, type Store } from '../server/prices';
import { browserIdentity } from '../server/browser-identity';
import type { IncomingMessage, ServerResponse } from 'node:http';
const image = { mediaType: 'image/jpeg' as const, data: '/9j/2Q==' };
const bar = { name: 'Example', address: 'Example 1', postcode: '8001' } as Bar;
const result = (value: unknown, stop_reason = 'end_turn') => Response.json({ stop_reason, content: [{ type: 'text', text: JSON.stringify(value) }] });

it('accepts coffee photos without a receipt or readable venue identity and counts tokens first', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ input_tokens: 1800 }))
    .mockResolvedValueOnce(result({ photo: true, coffeeVisible: true, wrongVenue: false }));
  await expect(verifyCoffeePhoto(image, bar, 'test', fetcher)).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toContain('count_tokens');
  const request = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(request.max_tokens).toBeLessThanOrEqual(200);
  expect(request.system).toContain('without venue identity is allowed');
  expect(request.messages[0].content[1].text).toContain('Example');
});
it.each([
  { photo: false, coffeeVisible: true, wrongVenue: false },
  { photo: true, coffeeVisible: false, wrongVenue: false },
  { photo: true, coffeeVisible: true, wrongVenue: true }, {}, null,
])('rejects unsuitable or incomplete verification %j', async value => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ input_tokens: 1800 })).mockResolvedValueOnce(result(value));
  await expect(verifyCoffeePhoto(image, bar, 'test', fetcher)).rejects.toHaveProperty('status', 422);
});
it('rejects truncated output and never retries a failed paid call', async () => {
  const truncated = vi.fn().mockResolvedValueOnce(Response.json({ input_tokens: 1800 })).mockResolvedValueOnce(result({}, 'max_tokens'));
  await expect(verifyCoffeePhoto(image, bar, 'test', truncated)).rejects.toHaveProperty('status', 422);
  const failed = vi.fn().mockResolvedValueOnce(Response.json({ input_tokens: 1800 })).mockRejectedValueOnce(new Error('offline'));
  await expect(verifyCoffeePhoto(image, bar, 'test', failed)).rejects.toHaveProperty('status', 503);
  expect(failed).toHaveBeenCalledTimes(2);
});
it('enforces both IP and browser quotas atomically and expires them after one hour', async () => {
  let state = emptyState(), version = 0;
  const store: Store = {
    async read() { return { state: structuredClone(state), etag: String(version) }; },
    async write(next, etag) { if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++; },
  };
  for (let n = 0; n < 9; n++) await reserveCoffeePhoto(store, 'ip', 'browser', 1000);
  const attempts = await Promise.allSettled([reserveCoffeePhoto(store, 'ip', 'browser', 1000), reserveCoffeePhoto(store, 'ip', 'browser', 1000)]);
  expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
  await expect(reserveCoffeePhoto(store, 'new-ip', 'browser', 1000)).rejects.toHaveProperty('status', 429);
  await expect(reserveCoffeePhoto(store, 'ip', 'new-browser', 1000)).resolves.toBeUndefined();
  for (let n = 11; n < 30; n++) await reserveCoffeePhoto(store, 'ip', `browser-${n}`, 1000);
  await expect(reserveCoffeePhoto(store, 'ip', 'another-browser', 1000)).rejects.toHaveProperty('status', 429);
  await expect(reserveCoffeePhoto(store, 'ip', 'browser', 3601000)).resolves.toBeUndefined();
});
it('signs browser cookies and replaces forged signatures', () => {
  let cookie = '';
  const response = { setHeader: (_: string, value: string) => { cookie = value; } } as ServerResponse;
  const request = (value?: string) => ({ headers: { cookie: value, origin: 'https://example.org' } }) as IncomingMessage;
  const owner = browserIdentity(request(), response, 'secret');
  expect(cookie).toContain('HttpOnly; SameSite=Lax'); expect(cookie).toContain('Secure');
  expect(browserIdentity(request(cookie), response, 'secret')).toBe(owner);
  expect(browserIdentity(request(cookie.replace(/\.[a-f0-9]{64}/, '.' + '0'.repeat(64))), response, 'secret')).not.toBe(owner);
});
