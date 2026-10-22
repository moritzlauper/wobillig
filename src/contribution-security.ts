import { t, locale } from './i18n';

type Config = { mailReady?: boolean; verified: boolean; emailRequired: boolean; protection: boolean; siteKey: string | null; paused: boolean };
type Turnstile = { render(container: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
let script: Promise<Turnstile> | undefined;
const message = (de: string, en: string) => locale() === 'en' ? en : de;
async function config(): Promise<Config> {
  const response = await fetch('/api/community-auth', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(message('Beiträge gerade nicht verfügbar. Bitte später versuchen.', 'Contributions are temporarily unavailable. Please try later.'));
  return response.json();
}
function modal(title: string) {
  const dialog = document.createElement('dialog'); dialog.className = 'contribution-security';
  const heading = document.createElement('h2'); heading.textContent = title; heading.id = `contribution-security-${crypto.randomUUID()}`; dialog.setAttribute('aria-labelledby', heading.id);
  const close = document.createElement('button'); close.type = 'button'; close.textContent = t('Schliessen'); close.onclick = () => dialog.close();
  const top = document.createElement('div'); top.className = 'dialog-top'; top.append(heading, close); dialog.append(top);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal(); return dialog;
}
async function botToken(settings: Config, action: string): Promise<string | undefined> {
  if (!settings.protection) return;
  if (!settings.siteKey) throw new Error(message('Beiträge sind vorübergehend pausiert.', 'Contributions are temporarily paused.'));
  if (!script) script = new Promise<Turnstile>((resolve, reject) => {
    const win = window as unknown as { turnstile?: Turnstile };
    if (win.turnstile) { resolve(win.turnstile); return; }
    const element = document.createElement('script'); element.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; element.async = true;
    const timeout = setTimeout(() => reject(new Error(message('Sicherheitsprüfung nicht geladen. Bitte erneut versuchen.', 'Security check could not load. Please retry.'))), 15000);
    element.onload = () => { clearTimeout(timeout); win.turnstile ? resolve(win.turnstile) : reject(new Error('Security check unavailable')); };
    element.onerror = () => { clearTimeout(timeout); element.remove(); reject(new Error(message('Sicherheitsprüfung nicht geladen. Bitte erneut versuchen.', 'Security check could not load. Please retry.'))); };
    document.head.append(element);
  }).catch(error => { script = undefined; throw error; });
  const turnstile = await script;
  const dialog = modal(message('Kurze Sicherheitsprüfung', 'Quick security check'));
  const container = document.createElement('div'); dialog.append(container);
  return new Promise((resolve, reject) => {
    let widget: string | undefined, settled = false;
    const finish = (value?: string) => { if (settled) return; settled = true; clearTimeout(timeout); if (widget) turnstile.remove(widget); dialog.remove(); value ? resolve(value) : reject(new Error(message('Sicherheitsprüfung abgebrochen. Dein Formular bleibt erhalten.', 'Security check cancelled. Your form is preserved.'))); };
    const timeout = setTimeout(() => finish(), 120000);
    dialog.addEventListener('close', () => finish());
    widget = turnstile.render(container, { sitekey: settings.siteKey, action, theme: 'auto', size: 'flexible', callback: (token: string) => finish(token), 'error-callback': () => finish(), 'expired-callback': () => finish() });
  });
}
async function authPost(body: object) {
  const response = await fetch('/api/community-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ? t(result.error) : message('Bestätigung fehlgeschlagen.', 'Verification failed.'));
  return result;
}
async function verifyEmail(settings: Config, account = false): Promise<void> {
  const dialog = modal(account ? message('Konto erstellen oder anmelden', 'Create an account or sign in') : message('E-Mail einmalig bestätigen', 'Verify your email once'));
  const explanation = document.createElement('p'); explanation.textContent = settings.emailRequired
    ? message('Zum Schutz vor Spam benötigen Beiträge eine bestätigte E-Mail-Adresse. Kein Newsletter. Dein Formular bleibt erhalten.', 'To prevent spam, contributions require a verified email address. No newsletter. Your form is preserved.')
    : message('Die E-Mail-Bestätigung ist freiwillig. Dein Konto erkennt dich auch in einem anderen Browser wieder. Maps könnt ihr gemeinsam über den Link bearbeiten, auch ohne Konto. Kein Newsletter.', 'Email verification is optional. Your account recognises you across browsers. Anyone with the link can collaborate on maps, including without an account. No newsletter.');
  const form = document.createElement('form'), label = document.createElement('label'), input = document.createElement('input'), submit = document.createElement('button'), error = document.createElement('p');
  label.textContent = message('E-Mail-Adresse', 'Email address'); input.type = 'email'; input.required = true; input.autocomplete = 'email'; input.maxLength = 254; input.name = 'email';
  label.append(input); submit.type = 'submit'; submit.className = 'primary'; submit.textContent = message('Code senden', 'Send code'); error.setAttribute('role', 'status');
  form.append(label, submit, error); dialog.append(explanation, form); input.focus();
  return new Promise((resolve, reject) => {
    let challenge = '', busy = false, done = false;
    dialog.addEventListener('close', () => { dialog.remove(); if (!done) reject(new Error(message('Bestätigung abgebrochen. Dein Formular bleibt erhalten.', 'Verification cancelled. Your form is preserved.'))); });
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return; busy = true; submit.disabled = true; error.textContent = '';
      try {
        if (!challenge) {
          const token = await botToken(settings, 'email');
          const result = await authPost({ action: 'request', email: input.value.trim(), botToken: token });
          if (!dialog.isConnected) return;
          challenge = result.challenge; label.firstChild!.textContent = message('Sechsstelliger Code', 'Six-digit code');
          input.value = ''; input.type = 'text'; input.name = 'code'; input.inputMode = 'numeric'; input.pattern = '[0-9]{6}'; input.maxLength = 6; input.autocomplete = 'one-time-code';
          submit.textContent = message('Bestätigen und fortfahren', 'Verify and continue');
          explanation.textContent = message('Prüfe dein Postfach und den Spamordner. Der Code gilt 10 Minuten und funktioniert in diesem Browser.', 'Check your inbox and spam folder. The code is valid for 10 minutes in this browser.'); input.focus();
        } else {
          await authPost({ action: 'confirm', challenge, code: input.value.trim() }); done = true; dialog.close(); resolve();
        }
      } catch (reason) { error.textContent = reason instanceof Error ? reason.message : message('Bitte erneut versuchen.', 'Please try again.'); }
      finally { busy = false; submit.disabled = false; }
    };
  });
}
export async function contributionFetch(url: string, body: object, timeout = 30000) {
  const settings = await config();
  if (settings.paused) throw new Error(message('Beiträge sind vorübergehend pausiert. Die Karte bleibt verfügbar.', 'Contributions are paused. The map remains available.'));
  if (settings.emailRequired && !settings.verified) await verifyEmail(settings);
  const token = await botToken(settings, 'contribute');
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, botToken: token }), signal: AbortSignal.timeout(timeout) });
}
export function accountControl(container: HTMLElement) {
  const button = document.createElement('button'); button.type = 'button';
  const updateLabel = (verified = false) => {
    button.textContent = verified ? message('Mein Konto', 'My account') : message('Konto erstellen', 'Create account');
    button.title = verified ? message('Mein Konto', 'My account') : message('Konto erstellen oder anmelden', 'Create an account or sign in');
  };
  updateLabel(); container.append(button);
  void config().then(settings => updateLabel(settings.verified)).catch(() => { /* Keep the account entry visible during outages. */ });
  button.onclick = async () => {
    button.disabled = true;
    try {
      const settings = await config();
      updateLabel(settings.verified);
      if (settings.verified) {
        const dialog = modal(message('E-Mail bestätigt', 'Email verified'));
        const error = document.createElement('p'); error.setAttribute('role', 'status');
        const logout = document.createElement('button'); logout.textContent = message('Abmelden', 'Sign out');
        logout.onclick = async () => {
          logout.disabled = true; error.textContent = '';
          try { await authPost({ action: 'logout' }); dialog.close(); location.reload(); }
          catch (reason) { error.textContent = reason instanceof Error ? reason.message : message('Bitte erneut versuchen.', 'Please try again.'); logout.disabled = false; }
        };
        dialog.append(logout, error);
      } else {
        if (!settings.mailReady && !settings.emailRequired) throw new Error(message('Die Kontoerstellung ist in dieser Umgebung noch nicht eingerichtet. Bitte verwende wobillig.ch.', 'Account creation is not configured in this environment yet. Please use wobillig.ch.'));
        await verifyEmail(settings, true);
        updateLabel(true);
      }
    } catch (reason) { const dialog = modal(message('Konto', 'Account')); const p = document.createElement('p'); p.textContent = reason instanceof Error ? reason.message : ''; dialog.append(p); }
    finally { button.disabled = false; }
  };
}
