import type { City } from './cities.js';
import { escapeHtml as e } from './data.js';
import { dateLocale, t } from './i18n.js';

type PizzaRating = { average: number | null; count: number; mine: number | null };

// Stars rate value for money, not overall quality, so they sit next to the external ratings.
// One vote per visitor and day. Choosing another star on the same day replaces the vote.
export function showPizzaRating(actions: HTMLElement, city: City, barId: string) {
  const group = document.createElement('div');
  group.className = 'pizza-rating';
  actions.after(group);
  let rating: PizzaRating | undefined;
  let saving = false, failed = false;
  const render = () => {
    if (!group.isConnected) return;
    const summary = rating ? rating.count
      ? `★ ${rating.average!.toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5 · ${rating.count}`
      : t('Noch keine Bewertung') : '';
    group.innerHTML = `<span class="pizza-rating-label">${t('Preis/Leistung')}</span>
      <span class="pizza-rating-stars" role="group" aria-label="${e(t('Preis/Leistung bewerten'))}">${[1, 2, 3, 4, 5].map(value => `<button type="button" data-stars="${value}" aria-pressed="${value === rating?.mine}" aria-label="${e(t('{score} von 5 Sternen', { score: value }))}" ${saving ? 'disabled' : ''}>${value} <span aria-hidden="true">★</span></button>`).join('')}</span>
      <span class="pizza-rating-summary">${e(summary)}</span>
      <span class="pizza-rating-message" role="${failed ? 'alert' : 'status'}">${failed ? e(t('Bewertung konnte nicht gespeichert werden. Bitte erneut versuchen.')) : ''}</span>`;
    group.querySelectorAll<HTMLButtonElement>('[data-stars]').forEach(button => {
      button.onclick = () => void vote(Number(button.dataset.stars));
    });
  };
  const load = async () => {
    try {
      const response = await fetch(`/api/pizza-rating?${new URLSearchParams({ city, bar: barId })}`, { cache: 'no-store' });
      if (response.ok) rating = await response.json() as PizzaRating;
    } catch { /* The control stays usable without a summary. */ }
    render();
  };
  const vote = async (stars: number) => {
    saving = true; failed = false; render();
    try {
      const response = await fetch('/api/pizza-rating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city, bar: barId, stars }),
      });
      if (response.ok) rating = await response.json() as PizzaRating;
      else failed = true;
    } catch { failed = true; }
    saving = false;
    render();
    group.querySelector<HTMLButtonElement>(`[data-stars="${stars}"]`)?.focus();
  };
  render();
  void load();
}
