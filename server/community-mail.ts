import nodemailer from 'nodemailer';
import { InputError } from '../src/community.js';
import { cities, type City } from '../src/cities.js';
import { mapVenueCount, type CustomMap } from '../src/custom-map-data.js';
import { reserveLimits, securityPath } from './community-security.js';
export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.COMMUNITY_EMAIL_FROM);
}
function transport(timeouts = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 }) {
  const port = Number(process.env.SMTP_PORT || '465');
  if (!mailConfigured() || ![465, 587].includes(port)) return;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, ...timeouts,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
}
export async function sendConfirmation(to: string, code: string, id: string) {
  const transporter = transport();
  if (!transporter) throw new InputError('E-Mail-Bestätigung ist noch nicht verfügbar.', 503);
  try {
    await transporter.sendMail({ from: process.env.COMMUNITY_EMAIL_FROM, to: { name: '', address: to },
      messageId: `<${id}@wobillig.ch>`, subject: 'Dein Bestätigungscode für wobillig',
      text: `Dein Code: ${code}\n\nGib ihn innerhalb von 10 Minuten im geöffneten wobillig-Fenster ein. Mit der Bestätigung kannst du Beiträge einreichen. Du erhältst keinen Newsletter.\n\nFalls du den Code nicht angefordert hast, ignoriere diese E-Mail.`,
    });
  } catch { throw new InputError('Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.', 503); }
  finally { transporter.close(); }
}

const reviewInbox = 'hello@wobillig.ch', reviewPage = 'https://wobillig.ch/output/price-review/production';
// The review page lists every request, so a missing notice must never fail the visitor's request.
export async function notifyMapRequest(city: City, map: CustomMap) {
  const transporter = transport({ connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000 });
  if (!transporter) return;
  const place = cities[city].name;
  const lines = map.automatic
    ? [`Automatische Map: ${map.name}`, `Stadt: ${place}`, `Angebotsseite (ungeprüft): ${map.automatic.sourceUrl}`, '', map.automatic.description, '', `Prüfen: ${reviewPage}#automatic-map-review`]
    : [`Map: ${map.name}`, `Stadt: ${place}`, `Orte mit Preis: ${mapVenueCount(map)}`, `Ansehen: https://wobillig.ch${cities[city].path}?map=${map.id}`, '', `Prüfen: ${reviewPage}#map-review`];
  try {
    await reserveLimits((await import('./prices.js')).blobStore(securityPath()), [{ key: 'map-notice:global', max: 50, ms: 86400000 }]);
    await transporter.sendMail({ from: process.env.COMMUNITY_EMAIL_FROM, to: reviewInbox,
      subject: `${map.automatic ? 'Automatische Map angefragt' : 'Map zur Veröffentlichung eingereicht'}: ${map.name} (${place})`,
      text: lines.join('\n') });
  } catch (error) { console.error('Map request notice failed', error instanceof Error ? error.name : 'UnknownError'); }
  finally { transporter.close(); }
}
