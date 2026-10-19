import { escapeHtml as e, isCurrentOffer, safeUrl, type PizzaMenuItem } from './data';
import { dateLocale, t } from './i18n';

export function pizzaMenuContent(items: PizzaMenuItem[] = []): string {
  const pizzas = items.filter(item => item.pizzaType === 'other' && Number.isFinite(item.priceChf)
    && item.priceChf > 0 && isCurrentOffer(item)).sort((a, b) => a.priceChf - b.priceChf || a.name.localeCompare(b.name));
  if (!pizzas.length) return '';
  return `<section class="pizza-menu"><h3>${t('Weitere Pizzen')}</h3>${pizzas.map(item => {
    const date = Number.isFinite(Date.parse(item.observedAt)) ? new Date(item.observedAt).toLocaleDateString(dateLocale()) : t('Datum unbekannt');
    return `<div class="offer"><div class="offer-top"><strong>${e(item.name)}</strong><strong class="nowrap">CHF ${item.priceChf.toFixed(2)}</strong></div>
      ${item.ingredients ? `<p class="muted">${e(item.ingredients)}</p>` : ''}
      ${item.priceContext === 'online_menu' ? `<div class="muted">${t('Onlinepreis')}</div>` : ''}
      <div class="offer-meta"><span>${item.confidence === 'ai' ? t('KI-erkannt') : t('Automatisch erkannt')} · ${e(date)}</span>
      ${safeUrl(item.sourceUrl) ? `<a href="${safeUrl(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('Quelle')}</a>` : ''}</div></div>`;
  }).join('')}</section>`;
}
