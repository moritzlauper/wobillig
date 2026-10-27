import type { City } from './cities.js';
import { t } from './i18n.js';
import type { GoogleRating } from '../server/google-rating.js';
import type { TripadvisorRating } from '../server/tripadvisor-rating.js';

let active: { key: string; controller: AbortController; request: Promise<GoogleRating | TripadvisorRating | null> } | undefined;

export function clearGoogleRating() {
  active?.controller.abort();
  active = undefined;
}

export function showGoogleRating(group: HTMLElement, city: City, id: string) {
  const key = `${city}:${id}`;
  if (active?.key !== key) {
    clearGoogleRating();
    const controller = new AbortController();
    const request = fetch(`/api/google-rating?${new URLSearchParams({ city, bar: id })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? (await response.json()).rating as GoogleRating | TripadvisorRating | null : null)
      .catch(() => null);
    // Keep only the currently displayed venue; rerenders share its request.
    active = { key, controller, request };
  }
  void active.request.then(rating => {
    if (!group.isConnected || !rating || !Number.isFinite(rating.rating) || rating.rating < 1 || rating.rating > 5) return;
    if ('source' in rating) return showTripadvisorRating(group, rating);
    const text = document.createElement('span');
    text.className = 'detail-rating';
    text.textContent = `${rating.rating.toFixed(1)}/5`;
    text.setAttribute('aria-label', t('Google-Bewertung: {rating} von 5', { rating: rating.rating.toFixed(1) }));
    text.title = t('{count} Google-Bewertungen', { count: rating.reviewCount });
    group.append(text);
    group.querySelector<HTMLAnchorElement>('a')!.href = rating.mapsUrl;
    for (const attribution of rating.attributions || []) {
      const link = document.createElement('a');
      link.textContent = attribution.provider;
      link.href = attribution.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      group.append(link);
    }
  });
}

// TripAdvisor requires its own bubble icon from the response and a link back to the listing.
function showTripadvisorRating(group: HTMLElement, rating: TripadvisorRating) {
  const text = document.createElement('span');
  text.className = 'detail-rating';
  const icon = document.createElement('img');
  icon.src = rating.iconUrl;
  icon.alt = '';
  icon.height = 14;
  text.append(icon, ` ${rating.rating.toFixed(1)}/5`);
  text.title = t('{count} Tripadvisor-Bewertungen', { count: rating.reviewCount });
  text.setAttribute('aria-label', t('Tripadvisor-Bewertung: {rating} von 5', { rating: rating.rating.toFixed(1) }));
  group.append(text);
  const link = document.createElement('a');
  link.textContent = 'Tripadvisor';
  link.href = rating.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  group.append(link);
}
