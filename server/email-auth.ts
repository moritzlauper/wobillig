import { mailConfigured, sendConfirmation } from './community-mail.js';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { InputError } from '../src/community.js';
import { WriteConflict } from './prices.js';
import { securityHash, securityPath, reserveLimits, requestIp } from './community-security.js';
import { appendCookie } from './http-cookies.js';

export type EmailChallenge = { hash: string; account: string; browser: string; expires: number; attempts: number };
const cookieName = 'wobillig-account';
export function verifiedAccount(req: IncomingMessage, now = Date.now()): string | undefined {
  const value = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value || value.length > 1000) return;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !/^[a-f0-9]{64}$/.test(signature)) return;
  if (!timingSafeEqual(Buffer.from(securityHash(`session:${payload}`), 'hex'), Buffer.from(signature, 'hex'))) return;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.sub === 'string' && /^[a-f0-9]{64}$/.test(data.sub) && Number.isFinite(data.exp) && data.exp > now && data.exp <= now + 31 * 86400000) return data.sub;
  } catch { /* Invalid session. */ }
}
export function sessionCookie(res: ServerResponse, account?: string) {
  const payload = Buffer.from(JSON.stringify({ sub: account, exp: Date.now() + 30 * 86400000 })).toString('base64url');
  appendCookie(res, `${cookieName}=${account ? `${payload}.${securityHash(`session:${payload}`)}` : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${account ? 2592000 : 0}${process.env.VERCEL_ENV ? '; Secure' : ''}`);
}
export async function requestEmailCode(req: IncomingMessage, browser: string, email: unknown) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new InputError('Bitte eine gültige E-Mail-Adresse eingeben.');
  if (!mailConfigured()) throw new InputError('E-Mail-Bestätigung ist noch nicht verfügbar.', 503);
  const normalized = email.trim().toLowerCase(), account = securityHash(`account:${normalized}`);
  const store = (await import('./prices.js')).blobStore(securityPath());
  await reserveLimits(store, [
    { key: `email:minute:${account}`, max: 1, ms: 60000 },
    { key: `email:hour:${account}`, max: 3, ms: 3600000 },
    { key: `email:ip:${requestIp(req)}`, max: 5, ms: 3600000 },
    { key: 'email:global', max: Number(process.env.COMMUNITY_EMAIL_DAILY_LIMIT || '200'), ms: 86400000 },
  ]);
  const id = randomBytes(24).toString('hex'), code = String(randomInt(100000, 1000000));
  const expires = Date.now() + 600000;
  let saved = false;
  for (let i = 0; i < 8; i++) {
    const { state, etag } = await store.read();
    state.emailChallenges = Object.fromEntries(Object.entries(state.emailChallenges || {}).filter(([, item]) => item.expires > Date.now() && item.browser !== browser));
    state.emailChallenges[id] = { hash: securityHash(`code:${id}:${code}`), account, browser, expires, attempts: 0 };
    try { await store.write(state, etag); saved = true; break; } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  if (!saved) throw new InputError('Bitte kurz warten und erneut versuchen.', 429);
  await sendConfirmation(normalized, code, id);
  return { challenge: id };
}
export async function confirmEmailCode(browser: string, id: unknown, code: unknown) {
  if (typeof id !== 'string' || !/^[a-f0-9]{48}$/.test(id) || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new InputError('Bitte den sechsstelligen Code eingeben.');
  const store = (await import('./prices.js')).blobStore(securityPath());
  for (let i = 0; i < 8; i++) {
    const { state, etag } = await store.read();
    const challenge = state.emailChallenges?.[id];
    if (!challenge || challenge.browser !== browser || challenge.expires <= Date.now() || challenge.attempts >= 5) throw new InputError('Code abgelaufen. Bitte einen neuen Code anfordern.', 401);
    const valid = timingSafeEqual(Buffer.from(challenge.hash, 'hex'), Buffer.from(securityHash(`code:${id}:${code}`), 'hex'));
    challenge.attempts++;
    if (valid) delete state.emailChallenges![id];
    try {
      await store.write(state, etag);
      if (!valid) throw new InputError('Der Code stimmt nicht. Bitte erneut eingeben.', 401);
      return challenge.account;
    } catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Bitte kurz warten und erneut versuchen.', 429);
}
