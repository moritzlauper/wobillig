import nodemailer from 'nodemailer';
import { InputError } from '../src/community.js';
export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.COMMUNITY_EMAIL_FROM);
}
export async function sendConfirmation(to: string, code: string, id: string) {
  if (!mailConfigured()) throw new InputError('E-Mail-Bestätigung ist noch nicht verfügbar.', 503);
  const port = Number(process.env.SMTP_PORT || '465');
  if (![465, 587].includes(port)) throw new InputError('E-Mail-Bestätigung ist noch nicht verfügbar.', 503);
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  try {
    await transporter.sendMail({ from: process.env.COMMUNITY_EMAIL_FROM, to,
      messageId: `<${id}@wobillig.ch>`, subject: 'Dein Bestätigungscode für wobillig',
      text: `Dein Code: ${code}\n\nGib ihn innerhalb von 10 Minuten im geöffneten wobillig-Fenster ein. Mit der Bestätigung kannst du Beiträge einreichen. Du erhältst keinen Newsletter.\n\nFalls du den Code nicht angefordert hast, ignoriere diese E-Mail.`,
    });
  } catch { throw new InputError('Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.', 503); }
  finally { transporter.close(); }
}
