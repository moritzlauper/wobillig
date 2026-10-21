import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyState, WriteConflict, type Store } from '../server/prices';
const mocks = vi.hoisted(() => ({ store: vi.fn(), send: vi.fn() }));
vi.mock('../server/prices.js', async original => ({ ...await original<typeof import('../server/prices')>(), blobStore: mocks.store }));
vi.mock('../server/community-mail.js', () => ({ mailConfigured: () => true, sendConfirmation: mocks.send }));
import { reserveLimits, checkBot, protectContribution, reservePhotoBudget, actorFor } from '../server/community-security';
import { requestEmailCode, confirmEmailCode, sessionCookie, verifiedAccount } from '../server/email-auth';
import { canEditMap, saveCustomMap } from '../server/custom-maps';
import { clearPublicCache, publicCommunity } from '../server/public-community';
import auth from '../api/community-auth';

function memory(): Store {
  let state = emptyState(), version = 0;
  return { read: vi.fn(async () => ({ state: structuredClone(state), etag: String(version) })), write: vi.fn(async (next, etag) => {
    if (etag !== String(version)) throw new WriteConflict(); state = structuredClone(next); version++;
  }) };
}
function req(cookie = '', origin = 'https://example.org') {
  return { method: 'POST', url: '/api/community-auth', headers: { host: 'example.org', origin, cookie, 'content-type': 'application/json' }, socket: { remoteAddress: 'ip-1' } } as IncomingMessage & { body?: unknown };
}
function res() {
  const headers: Record<string, any> = {}; let data: any;
  const value = { statusCode: 200, getHeader: (k: string) => headers[k], setHeader: (k: string, v: any) => { headers[k] = v; }, end: (v: string) => { data = JSON.parse(v); } } as unknown as ServerResponse;
  return { value, headers, data: () => data, cookie: () => [headers['Set-Cookie'] || []].flat().map((v: string) => v.split(';')[0]).join('; ') };
}
let store: Store;
beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-secret'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('CONTRIBUTION_PROTECTION', 'false'); vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', 'false');
  store = memory(); mocks.store.mockReturnValue(store); mocks.send.mockReset().mockResolvedValue(undefined);
  clearPublicCache();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('reserves global limits atomically under concurrent requests and expires them', async () => {
  const limits = [{ key: 'global', max: 3, ms: 1000 }];
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => reserveLimits(store, limits, 0)));
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(3);
  expect((await store.read()).state.securityCounters!.global.count).toBe(3);
  await expect(reserveLimits(store, limits, 1001)).resolves.toBeUndefined();
});
it('shares the photo budget between every endpoint and city and counts failed work', async () => {
  vi.stubEnv('COMMUNITY_PHOTO_DAILY_USD', '0.02');
  await reservePhotoBudget(); await reservePhotoBudget();
  await expect(reservePhotoBudget()).rejects.toMatchObject({ status: 429 });
  expect(mocks.store).toHaveBeenCalledWith('security/production.json');
});
it('reserves the full menu-scan retry ceiling from the shared daily budget', async () => {
  vi.stubEnv('COMMUNITY_PHOTO_DAILY_USD', '0.03');
  await reservePhotoBudget(0.02);
  await expect(reservePhotoBudget(0.02)).rejects.toMatchObject({ status: 429 });
  await reservePhotoBudget();
  expect((await store.read()).state.securityCounters!['photos:budget-cents'].count).toBe(3);
});
it('rejects missing, failed, replayed, wrong-host and wrong-action Turnstile results', async () => {
  vi.stubEnv('CONTRIBUTION_PROTECTION', 'true'); vi.stubEnv('TURNSTILE_SITE_KEY', 'site'); vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(checkBot(req(), undefined, 'contribute')).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
  for (const result of [{ success: false }, { success: true, hostname: 'evil.org', action: 'contribute' }, { success: true, hostname: 'example.org', action: 'email' }]) {
    fetcher.mockResolvedValue({ ok: true, json: async () => result });
    await expect(checkBot(req(), 'token', 'contribute')).rejects.toMatchObject({ status: 403 });
  }
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, hostname: 'example.org', action: 'contribute' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }) });
  await expect(checkBot(req(), 'token', 'contribute')).resolves.toBeUndefined();
  await expect(checkBot(req(), 'token', 'contribute')).rejects.toMatchObject({ status: 403 });
});
it('fails closed on missing bot configuration, network failures and disabled writes/photos', async () => {
  vi.stubEnv('CONTRIBUTION_PROTECTION', 'true');
  await expect(checkBot(req(), 'token', 'contribute')).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('TURNSTILE_SITE_KEY', 'site'); vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(checkBot(req(), 'token', 'contribute')).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('COMMUNITY_WRITES_PAUSED', 'true');
  await expect(protectContribution(req(), res().value, 'token')).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('COMMUNITY_WRITES_PAUSED', 'false'); vi.stubEnv('COMMUNITY_PHOTOS_PAUSED', 'true');
  await expect(protectContribution(req(), res().value, 'token', true)).rejects.toMatchObject({ status: 503 });
});
it('requires server-issued email sessions, rejecting forged and expired cookies', async () => {
  vi.stubEnv('EMAIL_VERIFICATION_REQUIRED', 'true');
  await expect(protectContribution(req('wobillig-account=forged'), res().value, '')).rejects.toMatchObject({ status: 401 });
  const response = res(); const account = 'a'.repeat(64); sessionCookie(response.value, account);
  const cookie = response.cookie(); expect(cookie).not.toContain(account);
  expect(verifiedAccount(req(cookie))).toBe(account);
  expect(verifiedAccount(req(cookie), Date.now() + 31 * 86400000)).toBeUndefined();
  expect(verifiedAccount(req(cookie.slice(0, -1) + 'x'))).toBeUndefined();
  await expect(protectContribution(req(cookie), res().value, '')).resolves.toMatchObject({ account });
});
it('uses single-use email codes bound to the requesting browser and stores no plain email or code', async () => {
  const { challenge } = await requestEmailCode(req(), 'browser-a', 'Person@example.org');
  const [, code] = mocks.send.mock.calls[0];
  expect(mocks.send.mock.calls[0][0]).toBe('person@example.org');
  const snapshot = JSON.stringify((await store.read()).state);
  expect(snapshot).not.toContain('person@example.org'); expect(snapshot).not.toContain(code);
  await expect(confirmEmailCode('browser-b', challenge, code)).rejects.toMatchObject({ status: 401 });
  const results = await Promise.allSettled([confirmEmailCode('browser-a', challenge, code), confirmEmailCode('browser-a', challenge, code)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await expect(confirmEmailCode('browser-a', challenge, code)).rejects.toMatchObject({ status: 401 });
});
it('locks codes after eight attempts and expires them after ten minutes', async () => {
  vi.useFakeTimers();
  const { challenge } = await requestEmailCode(req(), 'browser-a', 'person@example.org');
  const [, code] = mocks.send.mock.calls[0]; const wrong = code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 8; i++) await expect(confirmEmailCode('browser-a', challenge, wrong)).rejects.toMatchObject({ status: 401 });
  await expect(confirmEmailCode('browser-a', challenge, code)).rejects.toMatchObject({ status: 401 });
  const second = await requestEmailCode(req(), 'browser-b', 'other@example.org');
  vi.advanceTimersByTime(600001);
  await expect(confirmEmailCode('browser-b', second.challenge, mocks.send.mock.calls[1][1])).rejects.toMatchObject({ status: 401 });
});
it('limits email delivery per address and IP, keeping reservations when SMTP fails', async () => {
  mocks.send.mockRejectedValue(new Error('smtp failed'));
  await expect(requestEmailCode(req(), 'browser', 'person@example.org')).rejects.toThrow();
  await expect(requestEmailCode(req(), 'browser-2', 'PERSON@example.org')).rejects.toMatchObject({ status: 429 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it('keeps browser and email cookies together, and rejects cross-origin email requests', async () => {
  const response = res(); const request = req();
  actorFor(request, response.value); sessionCookie(response.value, 'a'.repeat(64));
  expect(response.headers['Set-Cookie']).toHaveLength(2);
  const bad = req('', 'https://evil.org'); bad.body = { action: 'request', email: 'person@example.org' };
  const result = res(); await auth(bad, result.value);
  expect(result.value.statusCode).toBe(403); expect(mocks.send).not.toHaveBeenCalled();
});
it('completes the account API flow and clears the secure session on logout', async () => {
  vi.stubEnv('CONTRIBUTION_PROTECTION', 'true');
  vi.stubEnv('TURNSTILE_SITE_KEY', 'site'); vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, hostname: 'example.org', action: 'email' }) }));
  const start = req(); start.body = { action: 'request', email: 'person@example.org', botToken: 'token' };
  const requested = res(); await auth(start, requested.value);
  expect(requested.value.statusCode).toBe(200);
  const confirm = req(requested.cookie()); confirm.body = { action: 'confirm', challenge: requested.data().challenge, code: mocks.send.mock.calls[0][1] };
  const confirmed = res(); await auth(confirm, confirmed.value);
  expect(confirmed.data()).toEqual({ verified: true });
  expect([confirmed.headers['Set-Cookie']].flat().join(';')).toMatch(/HttpOnly.*SameSite=Lax.*Secure/);
  const status = req(confirmed.cookie()); status.method = 'GET';
  const account = res(); await auth(status, account.value);
  expect(account.data()).toMatchObject({ verified: true, mailReady: true });
  const logout = req(confirmed.cookie()); logout.body = { action: 'logout' };
  const signedOut = res(); await auth(logout, signedOut.value);
  expect(signedOut.data()).toEqual({ verified: false });
  expect([signedOut.headers['Set-Cookie']].flat().join(';')).toContain('Max-Age=0');
  expect(verifiedAccount(req(signedOut.cookie()))).toBeUndefined();
});
it('allows collaboration on owned maps without replacing creator attribution', async () => {
  const id = 'd268dbea-93cf-45de-9d17-2b5c74090236';
  const map = await saveCustomMap(store, { action: 'createMap', mapId: id, name: 'Test' }, {}, 'visitor', 0, 'zurich', { browser: 'a', account: 'owner' });
  await expect(saveCustomMap(store, { action: 'withdrawMapPublication', mapId: id }, {}, 'other', 0, 'zurich', { browser: 'b', account: 'collaborator' })).resolves.toMatchObject({ id });
  await expect(saveCustomMap(store, { action: 'withdrawMapPublication', mapId: id }, {}, 'anonymous', 0, 'zurich', { browser: 'c' })).resolves.toMatchObject({ id });
  expect(canEditMap(map)).toBe(true);
  expect((await store.read()).state.mapOwners?.[id]).toEqual({ browser: 'a', account: 'owner' });
});
it('coalesces a burst of 200 public reads without exposing private state and expires the cache', async () => {
  const { state, etag } = await store.read(); state.emailChallenges = { private: { account: 'secret', hash: 'secret', browser: 'secret', expires: 1, attempts: 0 } }; state.mapOwners = { private: { browser: 'secret' } }; await store.write(state, etag);
  vi.mocked(store.read).mockClear();
  const results = await Promise.all(Array.from({ length: 200 }, () => publicCommunity('zurich', store, 0)));
  expect(store.read).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(results[0])).not.toContain('secret'); expect(results[0]).not.toHaveProperty('emailChallenges');
  await publicCommunity('zurich', store, 15001); expect(store.read).toHaveBeenCalledTimes(2);
});
