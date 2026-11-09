// Apartment alerts («Suchabos») for the Zürich apartment map. Listings come from
// angebunden's collector, which publishes wohnungen.json every five minutes. An
// alert stores a filter and an email address; after a double opt-in, every
// dispatch run mails the listings that are new and match the filter, checked with
// the same function as the map (src/apartment-data.ts).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import nodemailer from 'nodemailer';
import { InputError } from '../src/community.js';
import { translate, type Locale } from '../src/i18n.js';
import {
  alertFilter, apartmentChecksums, apartmentFacts, chf, describeApartmentFilter, filterApartments, parseApartmentFilter, slimApartmentData,
  type Apartment, type ApartmentData, type ApartmentFilter,
} from '../src/apartment-data.js';

export const APARTMENT_DATA_URL = process.env.APARTMENTS_DATA_URL || 'https://raw.githubusercontent.com/moritzlauper/angebunden/wohnungen/wohnungen.json';
const SITE = (process.env.SITE_URL || 'https://wobillig.ch').replace(/\/$/, '');

// --- Listings -------------------------------------------------------------

let cached: { at: number; data: Promise<ApartmentData> } | undefined;
/** The current listings, at most a minute old per server instance. */
export function apartmentData(now = Date.now()): Promise<ApartmentData> {
  if (cached && now - cached.at < 60000) return cached.data;
  const data = fetch(APARTMENT_DATA_URL, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } })
    .then(async response => {
      if (!response.ok) throw new Error(`Apartment data ${response.status}`);
      return slimApartmentData(await response.json());
    });
  cached = { at: now, data };
  data.catch(() => { if (cached?.data === data) cached = undefined; });
  return data;
}

type Ring = [number, number][];
let districtsPromise: Promise<{ number: number; bbox?: number[]; polygons: Ring[][] }[]> | undefined;
function inRing(lon: number, lat: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Kreis lookup from the official Zürich boundaries (public/data/districts.json). */
export async function zurichDistricts() {
  districtsPromise ||= readFile(`${process.cwd()}/public/data/districts.json`, 'utf8').then(text => {
    const json = JSON.parse(text) as { features: { bbox?: number[]; properties: { number: number }; geometry: { type: string; coordinates: unknown } }[] };
    return json.features.map(feature => ({
      number: feature.properties.number, bbox: feature.bbox,
      polygons: (feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates) as Ring[][],
    }));
  });
  const districts = await districtsPromise.catch(() => []);
  return ({ lat, lon }: { lat: number; lon: number }) => districts.find(d =>
    (!d.bbox || (lon >= d.bbox[0] && lat >= d.bbox[1] && lon <= d.bbox[2] && lat <= d.bbox[3]))
    && d.polygons.some(rings => inRing(lon, lat, rings[0]) && !rings.slice(1).some(hole => inRing(lon, lat, hole))))?.number;
}

// --- Storage --------------------------------------------------------------

export type ApartmentAlert = {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  filter: ApartmentFilter;
  created: string;
  status: 'pending' | 'active';
  /** Link in the opt-in email; removed once confirmed. */
  confirmToken?: string;
  confirmExpires?: number;
  /** For the unsubscribe link in every email and for managing the alert in the browser. */
  token: string;
  /** The welcome email with today's matches went out. */
  welcomed: boolean;
  /** Listings first seen up to here were checked. */
  checkedUntil: string | null;
  /** Checksums of listing links this alert already knows, newest first. */
  known: string[];
  lastSent?: string;
};
export type ApartmentState = { alerts: ApartmentAlert[] };
export type ApartmentStore = { read(): Promise<{ state: ApartmentState; etag?: string }>; write(state: ApartmentState, etag?: string): Promise<void> };
class WriteConflict extends Error {}

export function apartmentStore(path = `apartments/${process.env.VERCEL_ENV === 'production' ? 'production' : 'development'}.json`): ApartmentStore {
  return {
    async read() {
      const result = await get(path, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      if (!result) return { state: { alerts: [] } };
      if (result.statusCode !== 200) throw new Error('Unexpected storage response');
      const state = await new Response(result.stream).json() as ApartmentState;
      if (!Array.isArray(state.alerts)) throw new Error('Invalid stored state');
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        await put(path, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (!etag && error instanceof Error && /already exists/i.test(error.message))) throw new WriteConflict();
        throw error;
      }
    },
  };
}

/** Applies a change to the latest stored state, retrying when another request wrote in between. */
export async function updateAlerts<T>(store: ApartmentStore, change: (state: ApartmentState) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { state, etag } = await store.read();
    const result = change(state);
    try { await store.write(state, etag); return result; }
    catch (error) { if (!(error instanceof WriteConflict)) throw error; }
  }
  throw new InputError('Gerade werden viele Suchabos gespeichert. Bitte kurz warten und erneut versuchen.', 429);
}

const MAX_ALERTS = 5000, MAX_PER_EMAIL = 10, CONFIRM_MS = 48 * 3600000, KNOWN_LIMIT = 4000;
const tokenPattern = /^[A-Za-z0-9_-]{32,64}$/;
const newToken = () => randomBytes(24).toString('base64url');
const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const dropExpired = (state: ApartmentState, now: number) => {
  state.alerts = state.alerts.filter(alert => alert.status === 'active' || (alert.confirmExpires ?? 0) > now);
};

export function validEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value.trim())) throw new InputError('Bitte eine gültige E-Mail-Adresse eingeben.');
  return value.trim().toLowerCase();
}

/** Stores a pending alert and returns what the opt-in email needs. */
export async function createAlert(store: ApartmentStore, input: { email: unknown; filter: unknown; locale: unknown }, now = Date.now()) {
  const email = validEmail(input.email);
  const filter = alertFilter(parseApartmentFilter(input.filter));
  const locale: Locale = input.locale === 'en' ? 'en' : 'de';
  const alert: ApartmentAlert = {
    id: randomUUID(), email, locale, filter, name: describeApartmentFilter(filter, (text, vars) => translate(locale, text, vars)),
    created: new Date(now).toISOString(), status: 'pending', confirmToken: newToken(), confirmExpires: now + CONFIRM_MS,
    token: newToken(), welcomed: false, checkedUntil: null, known: [],
  };
  await updateAlerts(store, state => {
    dropExpired(state, now);
    if (state.alerts.length >= MAX_ALERTS) throw new InputError('Suchabos sind gerade ausgelastet. Bitte später erneut versuchen.', 503);
    if (state.alerts.filter(item => item.email === email).length >= MAX_PER_EMAIL) throw new InputError('Für diese E-Mail-Adresse bestehen schon zehn Suchabos. Bitte zuerst eines abmelden.', 429);
    state.alerts.push(alert);
  });
  return alert;
}

export async function confirmAlert(store: ApartmentStore, token: unknown, now = Date.now()) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw new InputError('Dieser Bestätigungslink ist ungültig.', 404);
  return updateAlerts(store, state => {
    const alert = state.alerts.find(item => item.confirmToken && sameToken(item.confirmToken, token));
    if (!alert) {
      // A second click on the same link is fine: the alert is already active.
      throw new InputError('Dieser Bestätigungslink ist abgelaufen oder wurde schon verwendet.', 404);
    }
    if ((alert.confirmExpires ?? 0) <= now) throw new InputError('Dieser Bestätigungslink ist abgelaufen oder wurde schon verwendet.', 404);
    alert.status = 'active'; delete alert.confirmToken; delete alert.confirmExpires;
    return { id: alert.id, name: alert.name, token: alert.token };
  });
}

export async function removeAlert(store: ApartmentStore, token: unknown) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw new InputError('Dieser Abmeldelink ist ungültig.', 404);
  return updateAlerts(store, state => {
    const alert = state.alerts.find(item => sameToken(item.token, token));
    if (!alert) return { removed: false };
    state.alerts = state.alerts.filter(item => item !== alert);
    return { removed: true, name: alert.name };
  });
}

/** What the browser may know about its own alerts, by their tokens. */
export async function alertStatuses(store: ApartmentStore, tokens: unknown) {
  if (!Array.isArray(tokens)) return [];
  const wanted = tokens.filter((token): token is string => typeof token === 'string' && tokenPattern.test(token)).slice(0, 20);
  const { state } = await store.read();
  return wanted.map(token => {
    const alert = state.alerts.find(item => sameToken(item.token, token));
    return alert ? { token, name: alert.name, status: alert.status, lastSent: alert.lastSent ?? null } : { token, status: 'gone' as const };
  });
}

// --- Email ----------------------------------------------------------------

/** «moritz@example.ch» → «mo…@example.ch»: enough to recognise an address in the review area, not to collect it. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}…@${domain ?? ''}`;
}

/** The alerts section of the password-protected review page, newest first; addresses stay shortened. */
export function apartmentAlertsReviewHtml(state: ApartmentState | undefined, environment: string): string {
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const date = (value: string | undefined) => value ? new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const head = '<section id="apartment-alerts" aria-labelledby="alerts-heading"><h2 id="alerts-heading">Suchabos Wohnungen</h2>';
  if (!state) return `${head}<p>Die Suchabos konnten gerade nicht geladen werden.</p></section>`;
  const alerts = [...state.alerts].sort((a, b) => b.created.localeCompare(a.created));
  const active = alerts.filter(alert => alert.status === 'active');
  const week = Date.now() - 7 * 86400000;
  const stat = (value: number, label: string) => `<div class="stat"><strong>${value}</strong>${label}</div>`;
  return `${head}<p>Speicher <code>apartments/${esc(environment)}.json</code> · Neueste zuerst · Adressen gekürzt. Unbestätigte Abos verschwinden nach 48 Stunden samt Adresse.</p>
    <div class="stats">${stat(active.length, 'aktive Suchabos')}${stat(alerts.length - active.length, 'warten auf Bestätigung')}${stat(new Set(active.map(alert => alert.email)).size, 'Adressen mit aktivem Abo')}${stat(active.filter(alert => alert.lastSent && Date.parse(alert.lastSent) >= week).length, 'in den letzten 7 Tagen gemailt')}</div>
    <div class="table-wrap"><table><thead><tr><th>Suche</th><th>E-Mail</th><th>Status</th><th>Angelegt</th><th>Zuletzt gemailt</th><th class="number">Bekannte Inserate</th></tr></thead><tbody>${alerts.map(alert => `<tr>
      <td><strong>${esc(alert.name)}</strong><small>${alert.locale === 'en' ? 'Englisch' : 'Deutsch'}</small></td>
      <td>${esc(maskEmail(alert.email))}</td>
      <td><span class="tag">${alert.status === 'active' ? 'Aktiv' : 'Bestätigung ausstehend'}</span>${alert.status === 'active' && !alert.welcomed ? '<small>Willkommensmail folgt beim nächsten Versand</small>' : ''}</td>
      <td class="nowrap">${date(alert.created)}</td><td class="nowrap">${date(alert.lastSent)}</td><td class="number">${alert.known.length}</td></tr>`).join('')}</tbody></table>
    ${alerts.length ? '' : '<p>Noch keine Suchabos.</p>'}</div></section>`;
}

export function apartmentMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.COMMUNITY_EMAIL_FROM);
}
function transport() {
  const port = Number(process.env.SMTP_PORT || '465');
  if (!apartmentMailConfigured() || ![465, 587].includes(port)) return;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
}
export type Mail = { to: string; subject: string; html: string; text: string; unsubscribe?: string };
export type MailSender = (mail: Mail) => Promise<void>;
export function smtpSender(): MailSender | undefined {
  const transporter = transport();
  if (!transporter) return;
  return async mail => {
    await transporter.sendMail({
      from: process.env.COMMUNITY_EMAIL_FROM, to: { name: '', address: mail.to }, subject: mail.subject, html: mail.html, text: mail.text,
      ...(mail.unsubscribe ? { list: { unsubscribe: { url: mail.unsubscribe, comment: 'Unsubscribe' } }, headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
    });
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeHttp = (url: string | null) => url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
export const mapLink = (locale: Locale, query = '') => `${SITE}${locale === 'en' ? '/en' : '/'}?map=wohnungen${query}`;
const unsubscribePage = (alert: ApartmentAlert) => mapLink(alert.locale, `&abmelden=${alert.token}`);
const unsubscribeOneClick = (alert: ApartmentAlert) => `${SITE}/api/apartments?unsubscribe=${alert.token}`;

// The colours and type of wobillig: Arial, dark text, grey dividers, square-ish dark buttons.
const font = 'Arial,Helvetica,sans-serif';
const price = (tr: (t: string, v?: Record<string, string | number>) => string, i: Apartment) => i.miete != null ? `CHF ${chf(i.miete)}` : tr('Preis auf Anfrage');

function row(i: Apartment, locale: Locale) {
  const tr = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const target = esc(safeHttp(i.links[0].url) || mapLink(locale));
  const image = safeHttp(i.bild);
  const thumb = image
    ? `<img src="${esc(image)}" width="88" height="66" alt="" style="display:block;width:88px;height:66px;object-fit:cover;border-radius:3px;border:1px solid #ddd;background:#f7f7f7">`
    : `<div style="width:88px;height:66px;border-radius:3px;border:1px solid #ddd;background:#f7f7f7"></div>`;
  const link = 'color:#222;text-decoration:none;display:block';
  return `<tr>
    <td style="padding:12px 12px 12px 0;vertical-align:top;border-bottom:1px solid #ddd;width:90px"><a href="${target}" style="${link}">${thumb}</a></td>
    <td style="padding:12px 0;vertical-align:top;border-bottom:1px solid #ddd;font-family:${font};color:#222">
      <a href="${target}" style="${link}"><strong style="display:block;font-size:14px;font-weight:600">${esc(i.titel)}</strong>
      <span style="display:block;margin-top:4px;font-size:12px;color:#666">${esc(apartmentFacts(i, tr).join(' · '))}</span></a>
      <a href="${esc(mapLink(locale, `&inserat=${encodeURIComponent(i.id)}&u=${encodeURIComponent(i.links[0].url)}`))}" style="display:inline-block;margin-top:6px;font-size:12px;color:#285b90">${esc(tr('Auf der Karte ansehen'))}</a>
    </td>
    <td style="padding:12px 0 12px 12px;vertical-align:top;border-bottom:1px solid #ddd;font-family:${font};font-size:14px;font-weight:bold;color:#222;white-space:nowrap;text-align:right"><a href="${target}" style="color:#222;text-decoration:none">${esc(price(tr, i))}</a></td>
  </tr>`;
}

function layout(locale: Locale, heading: string, intro: string, body: string, footer: string) {
  return `<!doctype html><html lang="${locale === 'en' ? 'en' : 'de-CH'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#fff">
  <div style="max-width:580px;margin:0 auto;padding:20px 16px 28px;font-family:${font};color:#222;font-size:14px">
    <div style="padding-bottom:10px;border-bottom:1px solid #ddd;font-size:12px;color:#666"><a href="${esc(mapLink(locale))}" style="color:#222;text-decoration:none;font-size:16px;font-weight:bold">wobillig</a>&nbsp;&nbsp;${esc(translate(locale, 'Wohnungen Zürich'))}</div>
    <h1 style="margin:18px 0 6px;font-size:18px;line-height:1.3;font-weight:bold">${heading}</h1>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#555">${esc(intro)}</p>
    ${body}
    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#666">${footer}</p>
  </div>
</body></html>`;
}
const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#262626;color:#fff;border:1px solid #262626;border-radius:3px;padding:9px 14px;font-family:${font};font-size:13px;text-decoration:none">${esc(label)}</a></p>`;

export function confirmationMail(alert: ApartmentAlert): Mail {
  const tr = (text: string, vars?: Record<string, string | number>) => translate(alert.locale, text, vars);
  const link = mapLink(alert.locale, `&bestaetigen=${alert.confirmToken}`);
  const subject = tr('Suchabo bestätigen: {name}', { name: alert.name });
  const intro = tr('Bitte bestätige dein Suchabo. Danach bekommst du eine E-Mail, sobald eine neue Wohnung zu deiner Suche passt. Der Link gilt 48 Stunden.');
  const ignore = tr('Falls du kein Suchabo angelegt hast, ignoriere diese E-Mail. Ohne Bestätigung wird deine Adresse nach 48 Stunden gelöscht.');
  return {
    to: alert.email, subject,
    html: layout(alert.locale, esc(tr('Suchabo bestätigen')), intro,
      `<p style="margin:12px 0 0;font-size:14px"><strong>${esc(alert.name)}</strong></p>${button(link, tr('Suchabo bestätigen'))}`, esc(ignore)),
    text: [tr('Suchabo bestätigen'), intro, alert.name, link, ignore].join('\n\n'),
  };
}

const MAX_IN_MAIL = 15, WELCOME_EXAMPLES = 5;
export function alertMail(alert: ApartmentAlert, listings: Apartment[], welcome: boolean): Mail {
  const tr = (text: string, vars?: Record<string, string | number>) => translate(alert.locale, text, vars);
  const one = listings[0];
  const short = one ? [one.miete != null ? `CHF ${chf(one.miete)}` : null, one.zimmer != null ? tr('{rooms} Zi.', { rooms: String(one.zimmer) }) : null, one.strasse ?? one.plz].filter(Boolean).join(', ') : '';
  const subject = welcome ? tr('Dein Suchabo «{name}» ist aktiv', { name: alert.name })
    : listings.length === 1 ? tr('Neue Wohnung: {listing}', { listing: short || one.titel })
    : tr('{count} neue Wohnungen: {name}', { count: listings.length, name: alert.name });
  const intro = welcome
    ? tr('Ab jetzt bekommst du eine E-Mail, sobald eine neue Wohnung zu deiner Suche passt. Neue Inserate kommen alle paar Minuten dazu.')
      + (listings.length ? ' ' + (listings.length === 1 ? tr('Heute passt schon eine Wohnung:') : tr('Heute passen schon {count}, hier die neuesten:', { count: listings.length })) : '')
    : tr('Diese Wohnungen sind seit der letzten E-Mail neu dazugekommen:');
  const shown = listings.slice(0, welcome ? WELCOME_EXAMPLES : MAX_IN_MAIL);
  const more = listings.length - shown.length;
  const heading = !welcome && listings.length === 1 && safeHttp(one.links[0].url)
    ? `<a href="${esc(one.links[0].url)}" style="color:#222;text-decoration:none">${esc(subject)}</a>` : esc(subject);
  const footerText = tr('Du bekommst diese E-Mail, weil du auf wobillig.ch das Suchabo «{name}» angelegt hast.', { name: alert.name });
  const footer = `${esc(footerText)}<br><a href="${esc(unsubscribePage(alert))}" style="color:#285b90">${esc(tr('Abmelden'))}</a> · <a href="${esc(mapLink(alert.locale))}" style="color:#285b90">${esc(tr('Suchabos verwalten'))}</a>`;
  const table = shown.length ? `<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #ddd;margin-top:10px">${shown.map(i => row(i, alert.locale)).join('')}</table>` : '';
  const moreLine = more > 0 ? `<p style="margin:10px 0 0;font-size:12px;color:#666">${esc(tr('und {count} weitere.', { count: more }))}</p>` : '';
  const text = [
    subject, intro,
    ...shown.map(i => `${price(tr, i)}, ${i.titel}\n${apartmentFacts(i, tr).join(' · ')}\n${i.links[0].url}`),
    ...(more > 0 ? [tr('und {count} weitere.', { count: more })] : []),
    `${tr('Alle auf der Karte ansehen')}: ${mapLink(alert.locale)}`,
    `${footerText}\n${tr('Abmelden')}: ${unsubscribePage(alert)}`,
  ].join('\n\n');
  return {
    to: alert.email, subject, unsubscribe: unsubscribeOneClick(alert), text,
    html: layout(alert.locale, heading, intro, table + moreLine + button(mapLink(alert.locale), tr('Alle auf der Karte ansehen')), footer),
  };
}

// --- Dispatch -------------------------------------------------------------

export type DispatchResult = { active: number; checked: number; mails: number; failed: number; deferred: number };

/**
 * Mails every active alert its new listings. The state is saved before sending, so a
 * crash means at most one missed email rather than the same listing twice; a failed
 * send restores the alert so the next run tries again.
 */
export async function dispatchAlerts(store: ApartmentStore, data: ApartmentData, send: MailSender, options: { maxMails?: number; deadline?: number } = {}): Promise<DispatchResult> {
  const maxMails = options.maxMails ?? 40, deadline = options.deadline ?? Date.now() + 45000;
  const district = await zurichDistricts();
  const now = Date.parse(data.erstellt) || Date.now();
  const { state } = await store.read();
  const active = state.alerts.filter(alert => alert.status === 'active');
  const result: DispatchResult = { active: active.length, checked: 0, mails: 0, failed: 0, deferred: 0 };
  for (const alert of active) {
    if (result.mails >= maxMails || Date.now() > deadline) { result.deferred++; continue; }
    result.checked++;
    const filter = alertFilter(alert.filter);
    // «Günstig» counts over everything that matches now, exactly as on the map.
    const matching = filterApartments(data.inserate, filter, { now, district }).list;
    const known = new Set(alert.known);
    const fresh = (alert.welcomed
      ? matching.filter(i => !apartmentChecksums(i).some(sum => known.has(sum)) && (!alert.checkedUntil || i.erstGesehen > alert.checkedUntil))
      : matching).sort((a, b) => b.erstGesehen.localeCompare(a.erstGesehen));
    const next = { welcomed: true, checkedUntil: data.erstellt, known: [...new Set([...matching.flatMap(apartmentChecksums), ...alert.known])].slice(0, KNOWN_LIMIT) };
    const previous = { welcomed: alert.welcomed, checkedUntil: alert.checkedUntil, known: alert.known, lastSent: alert.lastSent };
    const mail = !alert.welcomed || fresh.length ? alertMail(alert, fresh, !alert.welcomed) : undefined;
    const patch = (values: Partial<ApartmentAlert>) => updateAlerts(store, latest => {
      const target = latest.alerts.find(item => item.id === alert.id);
      if (target) Object.assign(target, values);
    });
    try {
      await patch({ ...next, ...(mail ? { lastSent: new Date().toISOString() } : {}) });
      if (!mail) continue;
      try { await send(mail); result.mails++; }
      catch (error) {
        result.failed++;
        await patch(previous).catch(() => undefined);
        console.error('Apartment alert email failed', error instanceof Error ? error.name : 'UnknownError');
      }
    } catch (error) { result.failed++; console.error('Apartment alert update failed', error instanceof Error ? error.name : 'UnknownError'); }
  }
  // Unconfirmed alerts disappear after 48 hours, with their email address.
  await updateAlerts(store, latest => dropExpired(latest, Date.now())).catch(() => undefined);
  return result;
}

/**
 * The scheduled workflow proves itself with a key both sides already have: an HMAC of
 * BLOB_READ_WRITE_TOKEN, which is stored in Vercel and as a GitHub secret anyway.
 * APARTMENT_ALERTS_SECRET (or CRON_SECRET) works as well, sent as is.
 */
export function dispatchKeys(): string[] {
  const keys = [process.env.APARTMENT_ALERTS_SECRET, process.env.CRON_SECRET].filter((key): key is string => Boolean(key && key.length >= 16));
  const blob = process.env.BLOB_READ_WRITE_TOKEN;
  if (blob) keys.push(createHmac('sha256', blob).update('wobillig-apartment-alerts').digest('hex'));
  return keys;
}
export function dispatchAuthorized(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = header.slice(7);
  return dispatchKeys().some(key => sameToken(given, key));
}
