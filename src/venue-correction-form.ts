import { contributionFetch } from './contribution-security';
import type { Bar } from './data';
import { t } from './i18n';
import { validateVenueCorrection, type VenueCorrection } from './venue-corrections';

export function venueCorrectionForm(api: string, saved: (correction: VenueCorrection) => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'venue-correction-dialog';
  dialog.setAttribute('aria-labelledby', 'venue-correction-title');
  dialog.innerHTML = `<form>
    <div class="dialog-top"><strong id="venue-correction-title" tabindex="-1">${t('Lokal korrigieren')}</strong><button type="button" id="venue-correction-close">${t('Schliessen')}</button></div>
    <p>${t('Korrigiere die Angaben zu diesem Lokal. Gespeicherte Änderungen sind öffentlich sichtbar. Bitte keinen neuen Eintrag anlegen.')}</p>
    <fieldset>
      <label>Name<input name="name" maxlength="100" autocomplete="organization" required></label>
      <label>${t('Strasse und Hausnummer')}<input name="address" maxlength="160" autocomplete="street-address"></label>
      <label>${t('Postleitzahl')}<input name="postcode" maxlength="4" inputmode="numeric" pattern="[0-9]{4}" autocomplete="postal-code"></label>
      <label>${t('Website (optional)')}<input name="website" type="url" maxlength="1500" placeholder="https://…"></label>
      <p class="muted">${t('Eine falsche Website kannst du ersetzen oder das Feld leeren.')}</p>
      <button type="submit" class="primary">${t('Korrektur speichern')}</button>
    </fieldset>
    <p role="alert" tabindex="-1" hidden></p>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const fields = dialog.querySelector('fieldset')!;
  const close = dialog.querySelector<HTMLButtonElement>('#venue-correction-close')!;
  const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const error = dialog.querySelector<HTMLElement>('[role="alert"]')!;
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  let current: Bar, revision = 0, busy = false;
  close.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    error.hidden = true;
    try {
      const changes = Object.fromEntries(['name', 'address', 'postcode', 'website']
        .filter(key => input(key).value.trim() !== (current[key as keyof Bar] || ''))
        .map(key => [key, input(key).value]));
      const raw = { barId: current.id, revision, changes };
      validateVenueCorrection(raw);
      busy = true; fields.disabled = true; close.disabled = true;
      submit.textContent = t('Speichern …');
      const response = await contributionFetch(api, { action: 'correctVenue', ...raw });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.correction) throw new Error(result.error || t('Speichern gerade nicht möglich. Bitte erneut versuchen.'));
      if (result.pending) { error.textContent = t('Danke. Dein Beitrag wird vor der Veröffentlichung geprüft.'); error.hidden = false; return; }
      dialog.close();
      saved(result.correction);
    } catch (reason) {
      error.textContent = reason instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(reason.name)
        ? t(reason.message) : t('Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.');
      error.hidden = false; error.focus();
    } finally {
      busy = false; fields.disabled = false; close.disabled = false;
      submit.textContent = t('Korrektur speichern');
    }
  };
  return (bar: Bar, version: number) => {
    current = bar; revision = version; form.reset(); error.hidden = true;
    for (const key of ['name', 'address', 'postcode', 'website'] as const) input(key).value = bar[key] || '';
    dialog.showModal();
    dialog.querySelector<HTMLElement>('#venue-correction-title')!.focus();
  };
}
