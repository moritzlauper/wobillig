import { contributionFetch } from './contribution-security';
import type { City } from './cities.js';
import { escapeHtml as e } from './data.js';
import { dateLocale, t } from './i18n.js';
import { isCoffeeRating, type CoffeeRatings } from './coffee-rating-data.js';
import { prepareMenuPhoto } from './menu-scan.js';

let ratings: CoffeeRatings = {};
const pending = new Set<string>();
let active: { key: string; refresh: () => void } | undefined;

export function loadCoffeeRatings(value: unknown) {
  ratings = value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([, rating]) => isCoffeeRating(rating))) : {};
}

export function showCoffeeRating(actions: HTMLElement, city: City, barId: string, available: boolean) {
  const key = `${city}:${barId}`;
  const group = document.createElement('span');
  group.className = 'coffee-rating-control';
  actions.querySelector('#share-bar')!.after(group);
  let expanded = false, message = '', failed = false;
  let score: number | undefined, photo: File | undefined;
  const render = () => {
    if (!group.isConnected) return;
    const rating = ratings[barId], saving = pending.has(key);
    const previousPicker = group.querySelector<HTMLInputElement>('.coffee-photo');
    const average = rating?.average?.toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const summary = rating ? rating.average === null
      ? t('Noch wenige Bewertungen · {count}', { count: rating.count })
      : `★ ${average}/5 · ${rating.count}` : '';
    group.innerHTML = `<button type="button" class="coffee-rate-toggle" aria-expanded="${expanded}" aria-controls="coffee-rating-editor" ${!available || saving ? 'disabled' : ''}>${t('Kaffee bewerten')}</button>${rating ? `<span class="coffee-rating-summary">${e(summary)}</span>` : ''}
      <span id="coffee-rating-editor" class="coffee-rating-editor" ${expanded ? '' : 'hidden'}>
        <span class="coffee-rating-stars" role="group" aria-label="${t('Kaffee bewerten')}">${[1, 2, 3, 4, 5].map(value => `<button type="button" data-score="${value}" aria-pressed="${value === score}" aria-label="${t('{score} von 5 Sternen', { score: value })}" ${saving ? 'disabled' : ''}>${value} <span aria-hidden="true">★</span></button>`).join('')}</span>
        <label class="coffee-photo-label">${t('Foto von deinem Kaffee im Lokal')}<input class="coffee-photo" type="file" accept="image/*" ${saving ? 'disabled' : ''}></label>
        <small>${photo ? t('Foto ausgewählt.') : t('Ein Kaffeefoto genügt. Keine Quittung nötig.')}</small>
        <small>${t('Das Foto wird zur Prüfung an Anthropic gesendet und von wobillig nicht gespeichert.')}</small>
        <button type="button" class="coffee-rating-save" ${saving || !photo || !score ? 'disabled' : ''}>${t('Bewertung speichern')}</button>
      </span><span class="coffee-rating-message" role="${failed ? 'alert' : 'status'}">${e(message)}</span>`;
    if (photo && previousPicker?.files?.[0] === photo) {
      previousPicker.disabled = saving;
      group.querySelector('.coffee-photo')!.replaceWith(previousPicker);
    }
    const toggle = group.querySelector<HTMLButtonElement>('.coffee-rate-toggle')!;
    toggle.title = available ? '' : t('Bewertungen sind gerade nicht verfügbar. Bitte neu laden.');
    toggle.onclick = () => { expanded = !expanded; message = ''; render(); group.querySelector<HTMLButtonElement>(expanded ? '[data-score]' : '.coffee-rate-toggle')!.focus(); };
    group.querySelectorAll<HTMLButtonElement>('[data-score]').forEach(button => {
      button.onclick = () => { score = Number(button.dataset.score); render(); group.querySelector<HTMLButtonElement>(`[data-score="${score}"]`)?.focus(); };
    });
    group.querySelector<HTMLInputElement>('.coffee-photo')!.onchange = event => {
      photo = (event.target as HTMLInputElement).files?.[0]; render();
    };
    group.querySelector<HTMLButtonElement>('.coffee-rating-save')!.onclick = async () => {
        if (pending.has(key) || !photo || !score) return;
        pending.add(key); message = t('Wird gespeichert …'); failed = false; render();
        try {
          const image = await prepareMenuPhoto(photo);
          const response = await contributionFetch(`/api/coffee-rating?city=${city}`, { barId, score, image }, 65000);
          const result = await response.json();
          if (!response.ok) throw new Error(typeof result.error === 'string' ? t(result.error) : t('Bewertung nicht gespeichert. Bitte erneut versuchen.'));
          if (!isCoffeeRating(result.rating)) throw new Error(t('Bewertung nicht gespeichert. Bitte erneut versuchen.'));
          ratings[barId] = result.rating;
          message = t('Danke für deine Bewertung.'); expanded = false; photo = undefined;
        } catch (error) {
          failed = true; message = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) && error.message
            ? error.message : t('Bewertung nicht gespeichert. Bitte erneut versuchen.');
        } finally {
          pending.delete(key);
          if (active?.key === key) active.refresh();
          if (group.isConnected) group.querySelector<HTMLButtonElement>(expanded ? '[data-score]' : '.coffee-rate-toggle')?.focus();
        }
      };
  };
  active = { key, refresh: render };
  render();
}
