import type { City } from './cities.js';
import { escapeHtml as e } from './data.js';
import { dateLocale, t } from './i18n.js';

type ValueRating = { average: number | null; count: number; mine: number | null };

// Stars rate value for money, not overall quality, so they sit next to the external ratings.
// One vote per visitor and day. Choosing another star on the same day replaces the vote.
export function showValueRating(actions: HTMLElement, city: City, barId: string) {
  const group = document.createElement('div');
  group.className = 'value-rating';
  actions.after(group);
  let rating: ValueRating | undefined;
  let saving = false, failed = false;
  const render = () => {
    if (!group.isConnected) return;
    const summary = rating ? rating.count
      ? `★ ${rating.average!.toLocaleString(dateLocale(), { maximumFractionDigits: 1 })}/5 · ${rating.count}`
      : t('Noch keine Bewertung') : '';
    group.innerHTML = `<span class="value-rating-label">${t('Preis/Leistung')}</span>
      <span class="value-rating-stars" role="group" aria-label="${e(t('Preis/Leistung bewerten'))}">${[1, 2, 3, 4, 5].map(value => `<button type="button" data-stars="${value}" class="${rating?.mine && value <= rating.mine ? 'on' : ''}" aria-label="${e(t('{score} von 5 Sternen', { score: value }))}" ${saving ? 'disabled' : ''}><span aria-hidden="true">★</span></button>`).join('')}</span>
      <span class="value-rating-meta"><span class="value-rating-summary">${e(summary)}</span>
      ${rating?.mine ? `<button type="button" class="value-rating-remove" ${saving ? 'disabled' : ''}>${e(t('Bewertung entfernen'))}</button>` : ''}</span>
      <span class="value-rating-message" role="${failed ? 'alert' : 'status'}">${failed ? e(t('Bewertung konnte nicht gespeichert werden. Bitte erneut versuchen.')) : ''}</span>`;
    // Hovering or focusing a star fills every star up to it. Leaving restores the saved vote.
    const starRow = group.querySelector<HTMLElement>('.value-rating-stars')!;
    const paint = (level: number) => group.querySelectorAll<HTMLButtonElement>('[data-stars]')
      .forEach(button => button.classList.toggle('on', Number(button.dataset.stars) <= level));
    group.querySelectorAll<HTMLButtonElement>('[data-stars]').forEach(button => {
      const value = Number(button.dataset.stars);
      button.onclick = () => void vote(value);
      button.onmouseenter = () => paint(value);
      button.onfocus = () => paint(value);
    });
    starRow.onmouseleave = () => paint(rating?.mine ?? 0);
    starRow.addEventListener('focusout', () => paint(rating?.mine ?? 0));
    const remove = group.querySelector<HTMLButtonElement>('.value-rating-remove');
    if (remove) remove.onclick = () => void removeVote();
  };
  const load = async () => {
    try {
      const response = await fetch(`/api/value-rating?${new URLSearchParams({ city, bar: barId })}`, { cache: 'no-store' });
      if (response.ok) rating = await response.json() as ValueRating;
    } catch { /* The control stays usable without a summary. */ }
    render();
  };
  const vote = async (stars: number) => {
    saving = true; failed = false; render();
    try {
      const response = await fetch('/api/value-rating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city, bar: barId, stars }),
      });
      if (response.ok) rating = await response.json() as ValueRating;
      else failed = true;
    } catch { failed = true; }
    saving = false;
    render();
    group.querySelector<HTMLButtonElement>(`[data-stars="${stars}"]`)?.focus();
  };
  const removeVote = async () => {
    saving = true; failed = false; render();
    try {
      const response = await fetch(`/api/value-rating?${new URLSearchParams({ city, bar: barId })}`, { method: 'DELETE' });
      if (response.ok) rating = await response.json() as ValueRating;
      else failed = true;
    } catch { failed = true; }
    saving = false;
    render();
  };
  render();
  void load();
}
