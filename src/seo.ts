import { cities, defaultCityLocale, type City } from './cities';
import { coffeeLabels, escapeHtml as e, isCurrentOffer, isStange, effectiveBeerType, type Bar, type Dataset, type Offer } from './data';
import { dateLocale, htmlLang, localizedPath, translate, type Locale } from './i18n';

// Vercel serves the apex domain and redirects www there. Canonicals, hreflang
// and the sitemap must name the final URL, not a redirect.
export const siteOrigin = 'https://wobillig.ch';
export const cityIds = Object.keys(cities) as City[];
export const coffeeGuideTypes = ['espresso', 'cappuccino'] as const;
export const guideTypes = [...coffeeGuideTypes, 'stange', 'margherita'] as const;
export type GuideType = typeof guideTypes[number];
const guideLabels: Record<string, string> = { ...coffeeLabels, stange: 'Stange', margherita: 'Pizza Margherita' };
export const guideDataset = (type: GuideType) => type === 'stange' ? 'bars' : type === 'margherita' ? 'pizza' : 'coffee';
const slugs: Record<City, string> = { zurich: 'zuerich', basel: 'basel', bern: 'bern', lausanne: 'lausanne', geneva: 'genf', winterthur: 'winterthur', olten: 'olten' };
export const guidePath = (city: City, type: GuideType, locale: Locale = 'de') => localizedPath(`/${type}-${slugs[city]}`, locale);
export const cityPath = (city: City, locale: Locale = 'de') => localizedPath(cities[city].path, locale);
export const localPath = (path: string, base = '/') => base.replace(/\/$/, '') + path;
const money = (price: number) => `CHF ${price.toFixed(2)}`;
const dateLabel = (date: string, locale: Locale = 'de') => new Intl.DateTimeFormat(dateLocale(locale), { timeZone: 'Europe/Zurich' }).format(new Date(date));
const cityName = (city: City, locale: Locale) => translate(locale, cities[city].name);
const ogLocales: Record<Locale, string> = { de: 'de_CH', en: 'en_GB' };

export function metadata(cityId: City, type?: GuideType, locale: Locale = 'de') {
  const city = cityName(cityId, locale);
  const tr = (text: string) => translate(locale, text, { city, label: type ? translate(locale, guideLabels[type]) : '' });
  if (type === 'stange' || type === 'margherita') return {
    title: tr(type === 'stange' ? 'Günstigste Stange in {city} | wobillig' : 'Günstigste Pizza Margherita in {city} | wobillig'),
    description: tr(type === 'stange' ? 'Stangenpreise in {city} vergleichen: günstige Lokale, Preise pro Glas, Adressen und Quellen.' : 'Pizza Margherita in Restaurants in {city} vergleichen: Preise pro Pizza, Adressen und Quellen. Ohne Imbisse und Takeaways.'),
    heading: tr(type === 'stange' ? 'Günstigste Stange in {city}' : 'Günstigste Pizza Margherita in {city}'),
    path: guidePath(cityId, type, locale),
  };
  return {
    title: type ? tr('{label}-Preise {city}: günstig vergleichen | wobillig') : tr('Kaffeepreise {city}: günstige Cafés finden | wobillig'),
    description: type
      ? tr('{label}-Preise in {city} vergleichen: erfasste Preise in CHF, günstige Lokale, Adressen und Quellen. Finde dein Café auf der wobillig-Karte.')
      : tr('Günstigen Kaffee in {city} finden: Espresso-, Cappuccino- und Café-crème-Preise vergleichen. Mit Karte, Preisquellen und weiteren Kaffee-, Bier- und Pizzapreisen.'),
    heading: type ? tr('{label}-Preise in {city}') : tr('Kaffeepreise in {city} vergleichen'),
    path: type ? guidePath(cityId, type, locale) : cityPath(cityId, locale),
  };
}

export function coffeePrices(dataset: Dataset, type: string, today?: string) {
  return dataset.bars.filter(bar => bar.type !== 'fast_food').flatMap(bar => {
    const offer = bar.offers.filter(offer => offer.coffeeType === type && !offer.pizzaType &&
      Number.isFinite(offer.priceChf) && offer.priceChf > 0 && isCurrentOffer(offer, today))
      .sort((a, b) => a.priceChf - b.priceChf)[0];
    return offer ? [{ bar, offer }] : [];
  }).sort((a, b) => a.offer.priceChf - b.offer.priceChf || a.bar.name.localeCompare(b.bar.name, 'de'));
}

export function guidePrices(dataset: Dataset, type: string, today?: string) {
  if (type !== 'stange' && type !== 'margherita') return coffeePrices(dataset, type, today);
  return dataset.bars.filter(bar => type === 'margherita' ? bar.type === 'restaurant' : bar.type !== 'fast_food').flatMap(bar => {
    const offer = bar.offers.filter(offer => Number.isFinite(offer.priceChf) && offer.priceChf > 0 && isCurrentOffer(offer, today) &&
      (type === 'margherita' ? offer.pizzaType === 'margherita' : isStange(offer) && effectiveBeerType(offer) === 'draft' && !offer.alcoholFree))
      .sort((a, b) => a.priceChf - b.priceChf)[0];
    return offer ? [{ bar, offer }] : [];
  }).sort((a, b) => a.offer.priceChf - b.offer.priceChf || a.bar.name.localeCompare(b.bar.name, 'de'));
}

export function mapLink(cityId: City, type: string, base = '/', bar?: Bar, locale: Locale = 'de') {
  const params = new URLSearchParams();
  if (type === 'stange') { params.set('drink', 'beer'); params.set('beerType', 'draft'); params.set('size', 'stange'); }
  else if (type === 'margherita') { params.set('drink', 'pizza'); params.set('type', 'restaurant'); }
  else { params.set('drink', 'coffee'); params.set('coffeeType', type); }
  for (const [key, value] of Object.entries({ sort: 'price', unknown: '0', max: 'all', cheap: '1' })) params.set(key, value);
  if (bar) params.set('bar', bar.id);
  return `${localPath(cityPath(cityId, locale), base)}?${params}#app`;
}

function source(offer: Offer, locale: Locale) {
  let url: URL;
  try { url = new URL(offer.sourceUrl); } catch { return translate(locale, 'Keine verlinkte Quelle'); }
  return /^https?:$/.test(url.protocol) ? `<a href="${e(url.href)}" rel="nofollow">${translate(locale, 'Preisquelle')}</a>` : translate(locale, 'Keine verlinkte Quelle');
}

function priceTable(cityId: City, type: string, dataset: Dataset, limit: number, base: string, locale: Locale = 'de') {
  const tr = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  const city = cityName(cityId, locale);
  const rows = guidePrices(dataset, type).slice(0, limit);
  if (!rows.length) return `<p>${tr('Für diese Sorte sind noch keine vergleichbaren Preise erfasst.')}</p>`;
  return `<div class="seo-table-wrap"><table><caption>${tr('{label} in {city}: {count} der günstigsten erfassten Lokale', { label: e(tr(guideLabels[type])), city, count: rows.length })}</caption>
    <thead><tr><th scope="col">${tr('Lokal / Adresse')}</th><th scope="col">${tr('Preis')}</th><th scope="col">${tr('Quelle / erfasst am')}</th></tr></thead>
    <tbody>${rows.map(({ bar, offer }) => `<tr><td><a href="${e(mapLink(cityId, type, base, bar, locale))}">${e(bar.name)}</a><small>${e([bar.address, bar.postcode, city].filter(Boolean).join(', '))}</small></td><td>${money(offer.priceChf)}${type === 'stange' && offer.beerType !== 'draft' ? `<small>${tr('Ausschankart geschätzt')}</small>` : ''}${offer.priceContext === 'online_menu' ? `<small>${tr('Onlinepreis')}</small>` : ''}</td><td>${source(offer, locale)}<small>${Number.isFinite(Date.parse(offer.observedAt)) ? dateLabel(offer.observedAt, locale) : tr('Datum unbekannt')} · ${offer.confidence === 'community' ? 'Community' : offer.confidence === 'reviewed' ? tr('Manuell geprüft') : tr('Automatisch erfasst')}</small></td></tr>`).join('')}</tbody>
  </table></div>`;
}

export function cityNavigation(base = '/', locale: Locale = 'de') {
  return `<nav class="seo-links" aria-label="${translate(locale, 'Kaffeepreise nach Stadt')}">${cityIds.map(id => `<a href="${localPath(cityPath(id, locale), base)}">${translate(locale, 'Kaffeepreise {city}', { city: cityName(id, locale) })}</a>`).join('')}</nav>`;
}

function methodology(dataset: Dataset, locale: Locale = 'de', type?: GuideType) {
  const tr = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  return `<section aria-labelledby="preisquellen"><h2 id="preisquellen">${tr(type === 'stange' || type === 'margherita' ? 'Woher stammen die Preise?' : 'Woher stammen die Kaffeepreise?')}</h2>
    <p>${tr(type === 'stange' || type === 'margherita' ? 'Die Übersicht verwendet öffentlich zugängliche Speise- und Getränkekarten sowie erfasste Preisangaben. Pro Lokal zählt der günstigste passende Einzelpreis in CHF. Lokale ohne passenden Preis werden nicht mitgerechnet. Die Rangliste ist keine vollständige Erhebung aller Lokale der Stadt.' : 'Die Übersicht verwendet öffentlich zugängliche Getränkekarten und erfasste Preisangaben. Pro Lokal und Kaffeesorte zählt der günstigste passende Einzelpreis in CHF. Lokale ohne passenden Preis werden hier nicht mitgerechnet. Der Durchschnitt beschreibt die erfassten Lokale, nicht sämtliche Cafés der Stadt.')}</p>
    <p>${tr('Datenstand: {date}. Die automatischen Daten werden planmässig alle drei Wochen aktualisiert. Das Erfassungsdatum zeigt, wann eine Quelle gelesen wurde; es garantiert keine neue Getränkekarte. Preise können sich ändern. Prüfe bei Bedarf die verlinkte Originalkarte.', { date: `<time datetime="${e(dataset.generatedAt)}">${dateLabel(dataset.generatedAt, locale)}</time>` })}</p>
    <p>${tr('In der interaktiven Karte kannst du Preise ergänzen oder korrigieren. Neue Community-Einträge erscheinen dort laufend; diese Übersicht zeigt den Datenstand des letzten Website-Builds. Standortdaten: {attribution}.', { attribution: e(dataset.attribution) })}</p></section>`;
}

export function cityContent(cityId: City, dataset: Dataset, base = '/', locale: Locale = 'de', beer?: Dataset, pizza?: Dataset) {
  const city = cityName(cityId, locale);
  const tr = (text: string, vars: Record<string, string | number> = {}) => translate(locale, text, { city, ...vars });
  const guideLink = (type: GuideType) => localPath(guidePath(cityId, type, locale), base);
  const summary = Object.entries(coffeeLabels).flatMap(([type, label]) => {
    const rows = coffeePrices(dataset, type);
    if (!rows.length) return [];
    const average = rows.reduce((sum, row) => sum + row.offer.priceChf, 0) / rows.length;
    const href = guideTypes.includes(type as GuideType) ? guideLink(type as GuideType) : mapLink(cityId, type, base, undefined, locale);
    return [`<tr><th scope="row"><a href="${e(href)}">${e(tr(label))}</a></th><td>${money(rows[0].offer.priceChf)}</td><td>${money(average)}</td><td>${rows.length}</td></tr>`];
  }).join('');
  return `<section id="kaffeepreise" class="seo-content" aria-labelledby="preisvergleich"><h2 id="preisvergleich">${tr('Günstigen Kaffee in {city} finden')}</h2>
    <p>${tr('Was kostet ein Espresso in {city}? Wo gibt es günstigen Cappuccino? wobillig vergleicht erfasste Kaffeepreise in Cafés, Restaurants und Bars in {city}. Wähle dieselbe Kaffeesorte, vergleiche den Preis pro Getränk und öffne das passende Lokal auf der Karte.')}</p>
    <div class="seo-table-wrap"><table><caption>${tr('Kaffeepreise {city} nach Sorte – günstigster erfasster Preis und Durchschnitt')}</caption><thead><tr><th scope="col">${tr('Kaffeesorte')}</th><th scope="col">${tr('Ab')}</th><th scope="col">${tr('Durchschnitt')}</th><th scope="col">${tr('Lokale mit Preis')}</th></tr></thead><tbody>${summary}</tbody></table></div>
    ${coffeeGuideTypes.map(type => `<section><h2>${tr('{label}-Preise in {city}', { label: tr(coffeeLabels[type]) })}</h2>${priceTable(cityId, type, dataset, 5, base, locale)}<p><a href="${e(guideLink(type))}">${tr('{label}-Preisvergleich {city} mit weiteren Lokalen', { label: tr(coffeeLabels[type]) })}</a></p></section>`).join('')}
    ${([['stange', beer, 'bierpreise'], ['margherita', pizza, 'pizzapreise']] as const).map(([type, data, id]) => `<section id="${id}"><h2>${metadata(cityId, type, locale).heading}</h2><p>${rankingDescription(type, locale)}</p>${data ? priceTable(cityId, type, data, 5, base, locale) : ''}<p><a href="${e(guideLink(type))}">${tr('{label}-Preisvergleich {city} mit weiteren Lokalen', { label: tr(guideLabels[type]) })}</a></p></section>`).join('')}
    <section><h2>${tr('Wie finde ich günstige Cafés in {city}?')}</h2><p>${tr('Wähle auf der Karte Espresso, Cappuccino, Café crème oder eine andere Sorte und sortiere nach aufsteigendem Preis. Mit «Günstig» grenzt du die Auswahl auf die preiswerten erfassten Angebote ein. Adresse, Quelle und Erfassungsdatum helfen dir, das Angebot vor deinem Besuch einzuschätzen.')}</p><p><a href="${e(mapLink(cityId, 'cappuccino', base, undefined, locale))}">${tr('Cappuccino auf der Karte vergleichen')}</a> · <a href="${e(mapLink(cityId, 'espresso', base, undefined, locale))}">${tr('Espresso auf der Karte vergleichen')}</a></p></section>
    <section><h2>${tr('Weitere Preise in {city}')}</h2><p>${tr('Auf wobillig kannst du auch Bierpreise nach Glasgrösse und Ausschankart vergleichen. Der Vergleich für Pizza Margherita wird freigeschaltet, sobald genügend Lokale mit Preisen erfasst sind.')}</p><a href="${localPath(cityPath(cityId, locale), base)}?drink=beer#app">${tr('Bierpreise {city} auf der Karte')}</a></section>
    ${methodology(dataset, locale)}${cityNavigation(base, locale)}
    <p><small><a href="https://wasstudieren.ch/">wasstudieren.ch</a></small></p></section>`;
}

export function guideContent(cityId: City, type: GuideType, dataset: Dataset, base = '/', locale: Locale = 'de') {
  if (type === 'stange' || type === 'margherita') return rankingContent(cityId, type, dataset, base, locale);
  const city = cityName(cityId, locale), label = translate(locale, coffeeLabels[type]);
  const tr = (text: string, vars: Record<string, string | number> = {}) => translate(locale, text, { city, label, ...vars });
  const rows = coffeePrices(dataset, type);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.offer.priceChf, 0) / rows.length : 0;
  const other = type === 'espresso' ? 'cappuccino' : 'espresso';
  const otherLocale: Locale = locale === 'de' ? 'en' : 'de';
  const home = localPath(cityPath(cityId, locale), base);
  return `<header class="guide-header"><a href="${home}">wobillig · ${city}</a><a class="language-switch" data-locale="${otherLocale}" href="${localPath(guidePath(cityId, type, otherLocale), base)}" hreflang="${htmlLang[otherLocale]}" lang="${htmlLang[otherLocale]}">${otherLocale === 'en' ? 'English' : 'Deutsch'}</a>${cityNavigation(base, locale)}</header><main class="seo-content seo-guide">
    <nav aria-label="${tr('Brotkrümel')}"><a href="${home}">${tr('Kaffeepreise {city}')}</a> / ${label}</nav>
    <h1>${tr('{label}-Preise in {city}')}</h1><p>${tr('Vergleiche {label} in {city} nach dem Preis pro Getränk. Die Übersicht zeigt günstige erfasste Angebote mit Adresse und Preisquelle; auf der Karte findest du weitere Lokale und kannst Preise ergänzen.')}</p>
    ${rows.length ? `<p class="seo-summary"><strong>${tr('{count} Lokale mit {label}-Preis', { count: rows.length })}</strong> · ${tr('ab {price}', { price: money(rows[0].offer.priceChf) })} · ${tr('Durchschnitt')} ${money(average)}</p>` : `<p>${tr('Noch keine vergleichbaren Preise erfasst.')}</p>`}
    <p><a class="seo-cta" href="${e(mapLink(cityId, type, base, undefined, locale))}">${tr('{label}-Preise auf der Karte öffnen')}</a></p>
    <h2>${tr('Wo gibt es günstigen {label} in {city}?')}</h2>${priceTable(cityId, type, dataset, 25, base, locale)}
    <h2>${tr('Was kostet ein {label} in {city}?')}</h2><p>${rows.length ? tr('Die erfassten Preise reichen von {min} bis {max}. Der Durchschnitt von {average} basiert auf dem günstigsten passenden Angebot je Lokal.', { min: money(rows[0].offer.priceChf), max: money(rows[rows.length - 1].offer.priceChf), average: money(average) }) : tr('Sobald passende Preise vorliegen, findest du hier die Preisspanne und den Durchschnitt.')} ${tr('Es handelt sich um einen Vergleich der vorhandenen Daten, nicht um eine vollständige Erhebung aller Cafés in {city}.')}</p>
    <h2>${tr('Welche Angebote sind vergleichbar?')}</h2><p>${type === 'espresso' ? tr('Hier vergleichen wir einfachen Espresso. Doppelter Espresso, Ristretto und Americano sind eigene Sorten und fliessen nicht in diesen Vergleich ein.') : tr('Hier vergleichen wir Cappuccino pro Getränk. Flat White, Milchkaffee und Latte macchiato sind eigene Sorten. Tassengrössen und mögliche Aufpreise für alternative Milch können je nach Lokal abweichen.')} ${tr('Massgeblich bleibt die Getränkekarte des Lokals.')}</p>
    ${methodology(dataset, locale)}<h2>${tr('Weitere Kaffeepreise vergleichen')}</h2><p><a href="${localPath(guidePath(cityId, other, locale), base)}">${tr('{label}-Preise {city}', { label: tr(coffeeLabels[other]) })}</a> · <a href="${home}">${tr('Alle Kaffeepreise {city}')}</a></p>
    <nav class="seo-links" aria-label="${tr('{label}-Preise nach Stadt')}">${cityIds.filter(id => id !== cityId).map(id => `<a href="${localPath(guidePath(id, type, locale), base)}">${tr('{label}-Preise {city}', { city: cityName(id, locale) })}</a>`).join('')}</nav>
    </main>`;
}

function rankingDescription(type: 'stange' | 'margherita', locale: Locale) {
  return translate(locale, type === 'margherita'
    ? 'Pizza Margherita aus Restaurants, ohne Imbisse und Takeaways. Verglichen wird der Preis pro regulärer ganzer Pizza.'
    : 'Verglichen wird der Preis pro Stange: 3 dl oder eine ausdrücklich als Stange bezeichnete kleine Portion. Flaschen, Dosen, alkoholfreies Bier und Biermischgetränke sind ausgeschlossen. Die Zuordnung zur Ausschankart kann auf einer gekennzeichneten Schätzung beruhen.');
}

function rankingContent(cityId: City, type: 'stange' | 'margherita', dataset: Dataset, base: string, locale: Locale) {
  const city = cityName(cityId, locale), label = translate(locale, guideLabels[type]);
  const tr = (text: string, vars: Record<string, string | number> = {}) => translate(locale, text, { city, label, ...vars });
  const rows = guidePrices(dataset, type);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.offer.priceChf, 0) / rows.length : 0;
  const home = localPath(cityPath(cityId, locale), base);
  const otherLocale = locale === 'de' ? 'en' : 'de';
  return `<header class="guide-header"><a href="${home}">wobillig · ${city}</a><a class="language-switch" data-locale="${otherLocale}" href="${localPath(guidePath(cityId, type, otherLocale), base)}" hreflang="${htmlLang[otherLocale]}" lang="${htmlLang[otherLocale]}">${otherLocale === 'en' ? 'English' : 'Deutsch'}</a></header>
    <main class="seo-content seo-guide"><nav aria-label="${tr('Brotkrümel')}"><a href="${home}">wobillig · ${city}</a> / ${label}</nav>
    <h1>${metadata(cityId, type, locale).heading}</h1><p>${rankingDescription(type, locale)}</p>
    ${rows.length ? `<p class="seo-summary"><strong>${tr('{count} Lokale mit {label}-Preis', { count: rows.length })}</strong> · ${tr('ab {price}', { price: money(rows[0].offer.priceChf) })} · ${tr('Durchschnitt')} ${money(average)}</p>` : `<p>${tr('Noch keine vergleichbaren Preise erfasst.')}</p>`}
    <p><a class="seo-cta" href="${e(mapLink(cityId, type, base, undefined, locale))}">${tr('{label}-Preise auf der Karte öffnen')}</a></p>
    ${priceTable(cityId, type, dataset, 25, base, locale)}
    <h2>${tr('Preisspanne')}</h2><p>${rows.length ? tr('Die erfassten Preise reichen von {min} bis {max}. Der Durchschnitt von {average} basiert auf dem günstigsten passenden Angebot je Lokal.', { min: money(rows[0].offer.priceChf), max: money(rows[rows.length - 1].offer.priceChf), average: money(average) }) : tr('Sobald passende Preise vorliegen, findest du hier die Preisspanne und den Durchschnitt.')}</p>
    ${methodology(dataset, locale, type)}<h2>${tr('Weitere Ranglisten')}</h2><nav class="seo-links">${guideTypes.filter(other => other !== type).map(other => `<a href="${localPath(guidePath(cityId, other, locale), base)}">${tr(guideLabels[other])}</a>`).join('')}</nav>
    <nav class="seo-links" aria-label="${tr('{label}-Preise nach Stadt')}">${cityIds.filter(id => id !== cityId).map(id => `<a href="${localPath(guidePath(id, type, locale), base)}">${tr('{label}-Preise {city}', { city: cityName(id, locale) })}</a>`).join('')}</nav></main>`;
}

export function seoHead(cityId: City, origin = siteOrigin, type?: GuideType, locale: Locale = 'de') {
  const meta = metadata(cityId, type, locale), url = origin + meta.path;
  const city = cityName(cityId, locale);
  const image = `${origin}/teaser/wobillig-teaser-wordmark-1180.png`;
  const graph: object[] = [
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: 'wobillig', alternateName: ['wobillig.ch'], inLanguage: ['de-CH', 'en'] },
    { '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: meta.title, description: meta.description, inLanguage: htmlLang[locale], isPartOf: { '@id': `${origin}/#website` }, about: { '@type': 'City', name: city } },
  ];
  if (type) graph.push({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: translate(locale, 'Kaffeepreise {city}', { city }), item: origin + cityPath(cityId, locale) },
    { '@type': 'ListItem', position: 2, name: translate(locale, '{label}-Preise', { label: translate(locale, guideLabels[type]) }), item: url },
  ] });
  // Lausanne and Geneva default to English; existing cities keep German.
  const alternatePath = (target: Locale) => metadata(cityId, type, target).path;
  const alternates = `
    <link rel="alternate" hreflang="de-CH" href="${e(origin + alternatePath('de'))}" /><link rel="alternate" hreflang="en" href="${e(origin + alternatePath('en'))}" /><link rel="alternate" hreflang="x-default" href="${e(origin + alternatePath(defaultCityLocale(cityId, 'de')))}" />
    <meta property="og:locale:alternate" content="${ogLocales[locale === 'de' ? 'en' : 'de']}" />`;
  return `<title>${e(meta.title)}</title>
    <meta name="description" content="${e(meta.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${e(url)}" />${alternates}
    <meta property="og:type" content="website" /><meta property="og:locale" content="${ogLocales[locale]}" />
    <meta property="og:site_name" content="wobillig" /><meta property="og:title" content="${e(meta.title)}" />
    <meta property="og:description" content="${e(meta.description)}" /><meta property="og:url" content="${e(url)}" />
    <meta property="og:image" content="${e(image)}" /><meta property="og:image:alt" content="wobillig" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
}
