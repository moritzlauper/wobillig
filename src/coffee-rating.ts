import type { City } from './cities.js';
import { escapeHtml as e } from './data.js';
import { dateLocale, t } from './i18n.js';
import { isCoffeeRating, type CoffeeRatings } from './coffee-rating-data.js';

let ratings: CoffeeRatings = {};
const tokens = new Map<string, string>();
const pending = new Set<string>();
let active: { key: string; refresh: () => void } | undefined;

export function loadCoffeeRatings(value: unknown) {
  ratings = value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([, rating]) => isCoffeeRating(rating))) : {};
}

function voterToken(key: string) {
  if (tokens.has(key)) return tokens.get(key)!;
  const storageKey = `wobillig:coffee-rating:${key}`;
  let token: string | null = null;
  try { token = localStorage.getItem(storageKey); } catch { /* Use session memory if storage is blocked. */ }
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) token = crypto.randomUUID();
  tokens.set(key, token);
  try { localStorage.setItem(storageKey, token); } catch { /* The in-memory token still deduplicates retries. */ }
  return token;
}

export function showCoffeeRating(actions: HTMLElement, city: City, barId: string, available: boolean) {
  const key = `${city}:${barId}`;
  const group = document.createElement('span');
  group.className = 'coffee-rating-control';
  actions.querySelector('#share-bar')!.after(group);
  let expanded = false, message = '', failed = false;
  const render = () => {
    if (!group.isConnected) return;
    const rating = ratings[barId], saving = pending.has(key);
    const average = rating?.average.toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    group.innerHTML = `<button type="button" class="coffee-rate-toggle" aria-expanded="${expanded}" aria-controls="coffee-rating-editor" ${!available || saving ? 'disabled' : ''}>${t('Kaffee bewerten')}</button>${rating ? `<span class="coffee-rating-summary" aria-label="${e(t('Kaffee: {rating} von 5, {count} Bewertungen', { rating: average!, count: rating.count }))}">★ ${average}/5 · ${rating.count}</span>` : ''}
      <span id="coffee-rating-editor" class="coffee-rating-editor" ${expanded ? '' : 'hidden'}>
        <span class="coffee-rating-stars" role="group" aria-label="${t('Kaffee bewerten')}">${[1, 2, 3, 4, 5].map(score => `<button type="button" data-score="${score}" aria-label="${t('{score} von 5 Sternen', { score })}" ${saving ? 'disabled' : ''}>${score} <span aria-hidden="true">★</span></button>`).join('')}</span>
      </span><span class="coffee-rating-message" role="${failed ? 'alert' : 'status'}">${e(message)}</span>`;
    const toggle = group.querySelector<HTMLButtonElement>('.coffee-rate-toggle')!;
    toggle.title = available ? '' : t('Bewertungen sind gerade nicht verfügbar. Bitte neu laden.');
    toggle.onclick = () => { expanded = !expanded; message = ''; render(); group.querySelector<HTMLButtonElement>(expanded ? '[data-score]' : '.coffee-rate-toggle')!.focus(); };
    group.querySelectorAll<HTMLButtonElement>('[data-score]').forEach(button => {
      button.onclick = async () => {
        if (pending.has(key)) return;
        pending.add(key); message = t('Wird gespeichert …'); failed = false; render();
        try {
          const response = await fetch(`/api/prices?city=${city}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rateCoffee', barId, score: Number(button.dataset.score), voterToken: voterToken(key) }),
            signal: AbortSignal.timeout(20000),
          });
          const result = await response.json();
          if (!response.ok || !isCoffeeRating(result.rating)) throw new Error();
          ratings[barId] = result.rating;
          message = t('Danke für deine Bewertung.'); expanded = false;
        } catch {
          failed = true; message = t('Bewertung nicht gespeichert. Bitte erneut versuchen.');
        } finally {
          pending.delete(key);
          if (active?.key === key) active.refresh();
          if (group.isConnected) group.querySelector<HTMLButtonElement>(expanded ? '[data-score]' : '.coffee-rate-toggle')?.focus();
        }
      };
    });
  };
  active = { key, refresh: render };
  render();
}
