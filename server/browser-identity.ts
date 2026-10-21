import { appendCookie } from './http-cookies.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const identities = new WeakMap<IncomingMessage, string>();
export function browserIdentity(req: IncomingMessage, res: ServerResponse, secret: string): string {
  const cached = identities.get(req); if (cached) return cached;
  const name = 'wobillig-browser';
  const sign = (token: string) => createHmac('sha256', secret).update(`browser-cookie:${token}`).digest('hex');
  const raw = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  let token = raw?.split('.')[0], signature = raw?.split('.')[1];
  if (!token || !signature || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(sign(token), 'hex'), Buffer.from(signature, 'hex'))) {
    token = randomBytes(32).toString('hex');
    appendCookie(res, `${name}=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${process.env.VERCEL_ENV === 'production' || req.headers.origin?.startsWith('https:') ? '; Secure' : ''}`);
  }
  const identity = createHmac('sha256', secret).update(`browser-owner:${token}`).digest('hex');
  identities.set(req, identity); return identity;
}
