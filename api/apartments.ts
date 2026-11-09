import type { IncomingMessage, ServerResponse } from 'node:http';
import { InputError } from '../src/community.js';
import { checkBot, protectionEnabled, requestIp, reserveLimits, sameOrigin, securityHash, securityPath } from '../server/community-security.js';
import {
  alertStatuses, apartmentData, apartmentMailConfigured, apartmentStore, confirmAlert, confirmationMail, createAlert, dispatchAlerts,
  dispatchAuthorized, removeAlert, smtpSender, validEmail,
} from '../server/apartments.js';

async function readBody(req: IncomingMessage & { body?: unknown }, limit: number): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON erwartet.', 415);
  if (Number(req.headers['content-length'] || 0) > limit) throw new InputError('Eintrag zu gross.', 413);
  let body = req.body;
  if (body === undefined) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw new InputError('Eintrag zu gross.', 413); chunks.push(Buffer.from(chunk)); }
    body = Buffer.concat(chunks).toString();
  }
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new InputError('Ungültiges JSON.'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Ungültige Anfrage.');
  return body as Record<string, unknown>;
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status: number, body: unknown, cache = 'private, no-store') => { res.statusCode = status; res.setHeader('Cache-Control', cache); res.end(JSON.stringify(body)); };
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return reply(405, { error: 'Methode nicht erlaubt.' }); }
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  try {
    // The listings, without the collector's memory. Shared by everyone, so the CDN keeps them two minutes.
    if (req.method === 'GET' && params.has('data')) {
      return reply(200, await apartmentData(), 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
    }
    // Called by the scheduled workflow (.github/workflows/apartment-alerts.yml).
    if (params.get('action') === 'dispatch') {
      if (!dispatchAuthorized(req.headers.authorization)) return reply(401, { error: 'Nicht berechtigt.' });
      const send = smtpSender();
      if (!send) return reply(503, { error: 'E-Mail-Versand ist nicht eingerichtet.' });
      return reply(200, await dispatchAlerts(apartmentStore(), await apartmentData(), send));
    }
    // One-click unsubscribe from the mail program (RFC 8058): a POST to the link in the List-Unsubscribe header.
    const unsubscribe = params.get('unsubscribe');
    if (req.method === 'POST' && unsubscribe !== null) {
      await removeAlert(apartmentStore(), unsubscribe);
      return reply(200, { removed: true });
    }
    if (req.method === 'GET') return reply(200, { mail: apartmentMailConfigured() });

    if (!sameOrigin(req)) throw new InputError('Bitte das Formular auf dieser Website verwenden.', 403);
    const body = await readBody(req, 32768);
    const store = apartmentStore();
    if (body.action === 'subscribe') {
      if (!apartmentMailConfigured()) throw new InputError('Suchabos sind gerade nicht verfügbar. Bitte später erneut versuchen.', 503);
      const email = validEmail(body.email);
      if (protectionEnabled()) await checkBot(req, body.botToken, 'contribute');
      await reserveLimits((await import('../server/prices.js')).blobStore(securityPath()), [
        { key: `apartment-alert:ip:${requestIp(req)}`, max: 10, ms: 3600000 },
        { key: `apartment-alert:email:${securityHash(`apartment-alert:${email}`)}`, max: 4, ms: 3600000 },
        { key: 'apartment-alert:global', max: Number(process.env.COMMUNITY_EMAIL_DAILY_LIMIT || '300'), ms: 86400000 },
      ]);
      const alert = await createAlert(store, { email, filter: body.filter, locale: body.locale });
      const send = smtpSender();
      try { await send!(confirmationMail(alert)); }
      catch {
        await removeAlert(store, alert.token).catch(() => undefined);
        throw new InputError('Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.', 503);
      }
      return reply(200, { token: alert.token, name: alert.name, status: alert.status });
    }
    if (body.action === 'smart') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new InputError('Die Smart-Suche ist gerade nicht verfügbar.', 503);
      // A sentence costs a fraction of a Rappen; the limits keep a script from running up the bill.
      await reserveLimits((await import('../server/prices.js')).blobStore(securityPath()), [
        { key: `apartment-smart:ip:${requestIp(req)}`, max: 60, ms: 3600000 },
        { key: 'apartment-smart:global', max: Number(process.env.APARTMENT_SMART_DAILY_LIMIT || '3000'), ms: 86400000 },
      ]);
      const { readApartmentQuery } = await import('../server/apartment-smart.js');
      return reply(200, { query: await readApartmentQuery(body.text, apiKey) });
    }
    if (body.action === 'confirm') return reply(200, await confirmAlert(store, body.token));
    if (body.action === 'unsubscribe') return reply(200, await removeAlert(store, body.token));
    if (body.action === 'status') return reply(200, { alerts: await alertStatuses(store, body.tokens) });
    throw new InputError('Ungültige Anfrage.');
  } catch (error) {
    if (error instanceof InputError) return reply(error.status, { error: error.message });
    console.error('Apartment request failed', error instanceof Error ? error.name : 'UnknownError');
    return reply(503, { error: 'Wohnungen können gerade nicht geladen werden. Bitte später erneut versuchen.' });
  }
}
