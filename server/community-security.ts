import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { InputError } from '../src/community.js';
import { WriteConflict, type Store } from './prices.js';
import { browserIdentity } from './browser-identity.js';
import { verifiedAccount } from './email-auth.js';

export type SecurityCounter = { count: number; expires: number };
export type Actor = { browser: string; account?: string };
import { protectionEnabled } from './community-policy.js';
export { protectionEnabled } from './community-policy.js';
export const securityPath = () => `security/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`;
export function securityHash(value: string) {
  const secret = process.env.COMMUNITY_AUTH_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new InputError('Beiträge sind gerade nicht verfügbar.', 503);
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function requestIp(req: IncomingMessage) {
  return securityHash(`ip:${req.headers['x-vercel-forwarded-for'] || req.socket.remoteAddress || 'unknown'}`);
}
export function actorFor(req: IncomingMessage, res: ServerResponse): Actor {
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new InputError('Beiträge sind gerade nicht verfügbar.', 503);
  return { browser: browserIdentity(req, res, secret), account: verifiedAccount(req) };
}
export function sameOrigin(req: IncomingMessage) {
  try { return typeof req.headers.origin === 'string' && new URL(req.headers.origin).host === req.headers.host && req.headers['sec-fetch-site'] !== 'cross-site'; }
  catch { return false; }
}
export async function reserveLimits(store: Store, limits: { key: string; max: number; ms: number; cost?: number }[], now = Date.now()) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    const counters = Object.fromEntries(Object.entries(state.securityCounters || {}).filter(([, value]) => value.expires > now));
    for (const { key, max, ms, cost = 1 } of limits) {
      const value = counters[key] || { count: 0, expires: now + ms };
      if (!Number.isFinite(max) || max <= 0 || value.count + cost > max) throw new InputError('Das Limit ist erreicht. Bitte später erneut versuchen.', 429);
      counters[key] = { ...value, count: value.count + cost };
    }
    state.securityCounters = counters;
    try { await store.write(state, etag); return; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Viele gleichzeitige Anfragen. Bitte kurz warten.', 429);
}
export async function checkBot(req: IncomingMessage, token: unknown, action: string) {
  if (!protectionEnabled()) return;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) throw new InputError('Beiträge sind vorübergehend pausiert.', 503);
  if (typeof token !== 'string' || !token || token.length > 2048) throw new InputError('Bitte die Sicherheitsprüfung abschliessen.', 403);
  let result;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, response: token }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    result = await response.json();
  } catch { throw new InputError('Sicherheitsprüfung gerade nicht verfügbar. Bitte erneut versuchen.', 503); }
  const hostname = req.headers.host?.split(':')[0];
  if (result.success !== true || result.hostname !== hostname || result.action !== action) throw new InputError('Sicherheitsprüfung abgelaufen. Bitte erneut versuchen.', 403);
}
export async function protectContribution(req: IncomingMessage, res: ServerResponse, token: unknown, photo = false) {
  if (process.env.COMMUNITY_WRITES_PAUSED === 'true' || photo && process.env.COMMUNITY_PHOTOS_PAUSED === 'true') throw new InputError('Beiträge sind vorübergehend pausiert. Die Karte bleibt verfügbar.', 503);
  const actor = actorFor(req, res);
  if (process.env.EMAIL_VERIFICATION_REQUIRED === 'true' && !actor.account) throw new InputError('Bitte zuerst deine E-Mail-Adresse bestätigen.', 401);
  if (protectionEnabled()) {
    await reserveLimits((await import('./prices.js')).blobStore(securityPath()), [
      { key: `write:ip:${requestIp(req)}`, max: 30, ms: 600000 },
      { key: `write:actor:${actor.account || actor.browser}`, max: 30, ms: 600000 },
    ]);
    await checkBot(req, token, 'contribute');
  }
  return actor;
}
export async function reservePhotoBudget() {
  // Global across all cities, both photo endpoints and all server instances.
  // Reserve before any paid call; failed requests keep their reservation.
  const dollars = Number(process.env.COMMUNITY_PHOTO_DAILY_USD || '2');
  await reserveLimits((await import('./prices.js')).blobStore(securityPath()), [
    { key: 'photos:hour', max: Number(process.env.COMMUNITY_PHOTO_HOURLY_LIMIT || '100'), ms: 3600000 },
    { key: 'photos:day', max: Number(process.env.COMMUNITY_PHOTO_DAILY_LIMIT || '1000'), ms: 86400000 },
    // Conservatively allocate one US cent per photo; the current model's bounded
    // token calls cost less. Review this allocation whenever the model changes.
    { key: 'photos:budget-cents', max: Math.floor(dollars * 100), cost: 1, ms: 86400000 },
  ]);
}
