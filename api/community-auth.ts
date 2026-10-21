import { mailConfigured } from '../server/community-mail.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { InputError } from '../src/community.js';
import { actorFor, checkBot, protectionEnabled, sameOrigin } from '../server/community-security.js';
import { requestEmailCode, confirmEmailCode, sessionCookie, verifiedAccount } from '../server/email-auth.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
  try {
    if (req.method === 'GET') return reply(200, { mailReady: mailConfigured() && protectionEnabled() && Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY), verified: Boolean(verifiedAccount(req)), emailRequired: process.env.EMAIL_VERIFICATION_REQUIRED === 'true',
      siteKey: protectionEnabled() ? process.env.TURNSTILE_SITE_KEY || null : null, protection: protectionEnabled(), paused: process.env.COMMUNITY_WRITES_PAUSED === 'true' });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return reply(405, {}); }
    if (!sameOrigin(req)) throw new InputError('Bitte das Formular auf dieser Website verwenden.', 403);
    if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON erwartet.', 415);
    if (Number(req.headers['content-length'] || 0) > 4096) throw new InputError('Eintrag zu gross.', 413);
    let body = req.body;
    if (body === undefined) {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw new InputError('Eintrag zu gross.', 413); chunks.push(Buffer.from(chunk)); }
      body = Buffer.concat(chunks).toString();
    }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new InputError('Ungültiges JSON.'); } }
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 4096) throw new InputError('Ungültige Anfrage.');
    const value = body as Record<string, unknown>;
    if (value.action === 'logout') { sessionCookie(res); return reply(200, { verified: false }); }
    const actor = actorFor(req, res);
    if (value.action === 'request') {
      if (!protectionEnabled()) throw new InputError('E-Mail-Bestätigung ist noch nicht verfügbar.', 503);
      if (process.env.COMMUNITY_WRITES_PAUSED === 'true') throw new InputError('Beiträge sind vorübergehend pausiert.', 503);
      await checkBot(req, value.botToken, 'email');
      return reply(200, await requestEmailCode(req, actor.browser, value.email));
    }
    if (value.action === 'confirm') {
      sessionCookie(res, await confirmEmailCode(actor.browser, value.challenge, value.code));
      return reply(200, { verified: true });
    }
    throw new InputError('Unbekannte Aktion.');
  } catch (error) {
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    return reply(503, { error: 'Bestätigung gerade nicht verfügbar. Bitte erneut versuchen.' });
  }
}
