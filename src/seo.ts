import { cities, type City } from './cities';
import { coffeeLabels, escapeHtml as e, isCurrentOffer, type Bar, type Dataset, type Offer } from './data';
import { dateLocale, htmlLang, localizedPath, translate, type Locale } from './i18n';

export const siteOrigin = 'https://wobillig.ch';
export const cityIds = Object.keys(cities) as City[];
export const guideTypes = ['espresso', 'cappuccino'] as const;
export type GuideType = typeof guideTypes[number];
const slugs: Record<City, string> = { zurich: 'zuerich', basel: 'basel', bern: 'bern' };
export const guidePath = (city: City, type: GuideType) => `/${type}-${slugs[city]}`;
export const cityPath = (city: City, locale: Locale = 'de') => localizedPath(cities[city].path, locale);
export const localPath = (path: string, base = '/') => base.replace(/\/$/, '') + path;
const money = (price: number) => `CHF ${price.toFixed(2)}`;
const dateLabel = (date: string, locale: Locale = 'de') => new Intl.DateTimeFormat(dateLocale(locale), { timeZone: 'Europe/Zurich' }).format(new Date(date));
const cityName = (city: City, locale: Locale) => translate(locale, cities[city].name);
const ogLocales: Record<Locale, string> = { de: 'de_CH', en: 'en_GB' };

// The espresso and cappuccino guides are German-only; English covers the city pages.
export function metadata(cityId: City, type?: GuideType, locale: Locale = 'de') {
  const city = cityName(cityId, locale);
  const tr = (text: string) => translate(locale, text, { city });
  return {
    title: type ? `${coffeeLabels[type]}-Preise ${city}: günstig vergleichen | wobillig` : tr('Kaffeepreise {city}: günstige Cafés finden | wobillig'),
    description: type
      ? `${coffeeLabels[type]}-Preise in ${city} vergleichen: erfasste Preise in CHF, günstige Lokale, Adressen und Quellen. Finde dein Café auf der wobillig-Karte.`
      : tr('Günstigen Kaffee in {city} finden: Espresso-, Cappuccino- und Café-crème-Preise vergleichen. Mit Karte, Preisquellen und weiteren Kaffee-, Bier- und Pizzapreisen.'),
    heading: type ? `${coffeeLabels[type]}-Preise in ${city}` : tr('Kaffeepreise in {city} vergleichen'),
    path: type ? guidePath(cityId, type) : cityPath(cityId, locale),
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

export function mapLink(cityId: City, type: string, base = '/', bar?: Bar, locale: Locale = 'de') {
  const params = new URLSearchParams({ drink: 'coffee', coffeeType: type, sort: 'price', unknown: '0', max: 'all' });
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
  const rows = coffeePrices(dataset, type).slice(0, limit);
  if (!rows.length) return `<p>${tr('Für diese Sorte sind noch keine vergleichbaren Preise erfasst.')}</p>`;
  return `<div class="seo-table-wrap"><table><caption>${tr('{label} in {city}: {count} der günstigsten erfassten Lokale', { label: e(tr(coffeeLabels[type])), city, count: rows.length })}</caption>
    <thead><tr><th scope="col">${tr('Lokal / Adresse')}</th><th scope="col">${tr('Preis')}</th><th scope="col">${tr('Quelle / erfasst am')}</th></tr></thead>
    <tbody>${rows.map(({ bar, offer }) => `<tr><td><a href="${e(mapLink(cityId, type, base, bar, locale))}">${e(bar.name)}</a><small>${e([bar.address, bar.postcode, city].filter(Boolean).join(', '))}</small></td><td>${money(offer.priceChf)}</td><td>${source(offer, locale)}<small>${Number.isFinite(Date.parse(offer.observedAt)) ? dateLabel(offer.observedAt, locale) : tr('Datum unbekannt')} · ${offer.confidence === 'community' ? 'Community' : offer.confidence === 'reviewed' ? tr('Manuell geprüft') : tr('Automatisch erfasst')}</small></td></tr>`).join('')}</tbody>
  </table></div>`;
}

export function cityNavigation(base = '/', locale: Locale = 'de') {
  return `<nav class="seo-links" aria-label="${translate(locale, 'Kaffeepreise nach Stadt')}">${cityIds.map(id => `<a href="${localPath(cityPath(id, locale), base)}">${translate(locale, 'Kaffeepreise {city}', { city: cityName(id, locale) })}</a>`).join('')}</nav>`;
}

function methodology(dataset: Dataset, locale: Locale = 'de') {
  const tr = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  return `<section aria-labelledby="preisquellen"><h2 id="preisquellen">${tr('Woher stammen die Kaffeepreise?')}</h2>
    <p>${tr('Die Übersicht verwendet öffentlich zugängliche Getränkekarten und erfasste Preisangaben. Pro Lokal und Kaffeesorte zählt der günstigste passende Einzelpreis in CHF. Lokale ohne passenden Preis werden hier nicht mitgerechnet. Der Durchschnitt beschreibt die erfassten Lokale, nicht sämtliche Cafés der Stadt.')}</p>
    <p>${tr('Datenstand: {date}. Die automatischen Daten werden planmässig alle drei Wochen aktualisiert. Das Erfassungsdatum zeigt, wann eine Quelle gelesen wurde; es garantiert keine neue Getränkekarte. Preise können sich ändern. Prüfe bei Bedarf die verlinkte Originalkarte.', { date: `<time datetime="${e(dataset.generatedAt)}">${dateLabel(dataset.generatedAt, locale)}</time>` })}</p>
    <p>${tr('In der interaktiven Karte kannst du Preise ergänzen oder korrigieren. Neue Community-Einträge erscheinen dort laufend; diese Übersicht zeigt den Datenstand des letzten Website-Builds. Standortdaten: {attribution}.', { attribution: e(dataset.attribution) })}</p></section>`;
}

export function cityContent(cityId: City, dataset: Dataset, base = '/', locale: Locale = 'de') {
  const city = cityName(cityId, locale);
  const tr = (text: string, vars: Record<string, string | number> = {}) => translate(locale, text, { city, ...vars });
  // English pages link to the map instead of the German-only guides.
  const guideLink = (type: GuideType) => locale === 'de' ? localPath(guidePath(cityId, type), base) : mapLink(cityId, type, base, undefined, locale);
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
    ${guideTypes.map(type => `<section><h2>${tr('{label}-Preise in {city}', { label: tr(coffeeLabels[type]) })}</h2>${priceTable(cityId, type, dataset, 5, base, locale)}<p><a href="${e(guideLink(type))}">${tr('{label}-Preisvergleich {city} mit weiteren Lokalen', { label: tr(coffeeLabels[type]) })}</a></p></section>`).join('')}
    <section><h2>${tr('Wie finde ich günstige Cafés in {city}?')}</h2><p>${tr('Wähle auf der Karte Espresso, Cappuccino, Café crème oder eine andere Sorte und sortiere nach aufsteigendem Preis. Mit «Günstig» grenzt du die Auswahl auf die preiswerten erfassten Angebote ein. Adresse, Quelle und Erfassungsdatum helfen dir, das Angebot vor deinem Besuch einzuschätzen.')}</p><p><a href="${e(mapLink(cityId, 'cappuccino', base, undefined, locale))}">${tr('Cappuccino auf der Karte vergleichen')}</a> · <a href="${e(mapLink(cityId, 'espresso', base, undefined, locale))}">${tr('Espresso auf der Karte vergleichen')}</a></p></section>
    <section><h2>${tr('Weitere Preise in {city}')}</h2><p>${tr('Auf wobillig kannst du auch Bierpreise nach Glasgrösse und Ausschankart vergleichen. Der Vergleich für Pizza Margherita wird freigeschaltet, sobald genügend Lokale mit Preisen erfasst sind.')}</p><a href="${localPath(cityPath(cityId, locale), base)}?drink=beer#app">${tr('Bierpreise {city} auf der Karte')}</a></section>
    ${methodology(dataset, locale)}${cityNavigation(base, locale)}</section>`;
}

export function guideContent(cityId: City, type: GuideType, dataset: Dataset, base = '/') {
  const city = cities[cityId].name, label = coffeeLabels[type];
  const rows = coffeePrices(dataset, type);
  const average = rows.length ? rows.reduce((sum, row) => sum + row.offer.priceChf, 0) / rows.length : 0;
  const other = type === 'espresso' ? 'cappuccino' : 'espresso';
  return `<header class="guide-header"><a href="${localPath(cities[cityId].path, base)}">wobillig · ${city}</a>${cityNavigation(base)}</header><main class="seo-content seo-guide">
    <nav aria-label="Brotkrümel"><a href="${localPath(cities[cityId].path, base)}">Kaffeepreise ${city}</a> / ${label}</nav>
    <h1>${label}-Preise in ${city}</h1><p>Vergleiche ${label} in ${city} nach dem Preis pro Getränk. Die Übersicht zeigt günstige erfasste Angebote mit Adresse und Preisquelle; auf der Karte findest du weitere Lokale und kannst Preise ergänzen.</p>
    ${rows.length ? `<p class="seo-summary"><strong>${rows.length} Lokale mit ${label}-Preis</strong> · ab ${money(rows[0].offer.priceChf)} · Durchschnitt ${money(average)}</p>` : '<p>Noch keine vergleichbaren Preise erfasst.</p>'}
    <p><a class="seo-cta" href="${e(mapLink(cityId, type, base))}">${label}-Preise auf der Karte öffnen</a></p>
    <h2>Wo gibt es günstigen ${label} in ${city}?</h2>${priceTable(cityId, type, dataset, 25, base)}
    <h2>Was kostet ein ${label} in ${city}?</h2><p>${rows.length ? `Die erfassten Preise reichen von ${money(rows[0].offer.priceChf)} bis ${money(rows[rows.length - 1].offer.priceChf)}. Der Durchschnitt von ${money(average)} basiert auf dem günstigsten passenden Angebot je Lokal.` : 'Sobald passende Preise vorliegen, findest du hier die Preisspanne und den Durchschnitt.'} Es handelt sich um einen Vergleich der vorhandenen Daten, nicht um eine vollständige Erhebung aller Cafés in ${city}.</p>
    <h2>Welche Angebote sind vergleichbar?</h2><p>${type === 'espresso' ? 'Hier vergleichen wir einfachen Espresso. Doppelter Espresso, Ristretto und Americano sind eigene Sorten und fliessen nicht in diesen Vergleich ein.' : 'Hier vergleichen wir Cappuccino pro Getränk. Flat White, Milchkaffee und Latte macchiato sind eigene Sorten. Tassengrössen und mögliche Aufpreise für alternative Milch können je nach Lokal abweichen.'} Massgeblich bleibt die Getränkekarte des Lokals.</p>
    ${methodology(dataset)}<h2>Weitere Kaffeepreise vergleichen</h2><p><a href="${localPath(guidePath(cityId, other), base)}">${coffeeLabels[other]}-Preise ${city}</a> · <a href="${localPath(cities[cityId].path, base)}">Alle Kaffeepreise ${city}</a></p>
    <nav class="seo-links" aria-label="${label}-Preise nach Stadt">${cityIds.filter(id => id !== cityId).map(id => `<a href="${localPath(guidePath(id, type), base)}">${label}-Preise ${cities[id].name}</a>`).join('')}</nav>
    </main>`;
}

export function seoHead(cityId: City, origin = siteOrigin, type?: GuideType, locale: Locale = 'de') {
  const meta = metadata(cityId, type, locale), url = origin + meta.path;
  const city = cityName(cityId, locale);
  const image = `${origin}/teaser/wobillig-teaser-wordmark-1180.png`;
  const graph: object[] = [
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: 'wobillig', inLanguage: ['de-CH', 'en'] },
    { '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: meta.title, description: meta.description, inLanguage: type ? 'de-CH' : htmlLang[locale], isPartOf: { '@id': `${origin}/#website` }, about: { '@type': 'City', name: city } },
  ];
  if (type) graph.push({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: `Kaffeepreise ${cities[cityId].name}`, item: origin + cities[cityId].path },
    { '@type': 'ListItem', position: 2, name: `${coffeeLabels[type]}-Preise`, item: url },
  ] });
  // City pages exist in both languages; German stays the default for other visitors.
  const alternates = type ? '' : `
    <link rel="alternate" hreflang="de-CH" href="${e(origin + cityPath(cityId, 'de'))}" /><link rel="alternate" hreflang="en" href="${e(origin + cityPath(cityId, 'en'))}" /><link rel="alternate" hreflang="x-default" href="${e(origin + cityPath(cityId, 'de'))}" />
    <meta property="og:locale:alternate" content="${ogLocales[locale === 'de' ? 'en' : 'de']}" />`;
  return `<title>${e(meta.title)}</title>
    <meta name="description" content="${e(meta.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${e(url)}" />${alternates}
    <meta property="og:type" content="website" /><meta property="og:locale" content="${type ? ogLocales.de : ogLocales[locale]}" />
    <meta property="og:site_name" content="wobillig" /><meta property="og:title" content="${e(meta.title)}" />
    <meta property="og:description" content="${e(meta.description)}" /><meta property="og:url" content="${e(url)}" />
    <meta property="og:image" content="${e(image)}" /><meta property="og:image:alt" content="wobillig" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
}
