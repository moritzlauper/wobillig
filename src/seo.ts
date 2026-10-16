import { cities, type City } from './cities';
import { coffeeLabels, escapeHtml as e, isCurrentOffer, type Bar, type Dataset, type Offer } from './data';

export const siteOrigin = 'https://wobillig.ch';
export const cityIds = Object.keys(cities) as City[];
export const guideTypes = ['espresso', 'cappuccino'] as const;
export type GuideType = typeof guideTypes[number];
const slugs: Record<City, string> = { zurich: 'zuerich', basel: 'basel', bern: 'bern' };
export const guidePath = (city: City, type: GuideType) => `/${type}-${slugs[city]}`;
export const localPath = (path: string, base = '/') => base.replace(/\/$/, '') + path;
const money = (price: number) => `CHF ${price.toFixed(2)}`;
const dateLabel = (date: string) => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich' }).format(new Date(date));

export function metadata(cityId: City, type?: GuideType) {
  const city = cities[cityId].name;
  return {
    title: type ? `${coffeeLabels[type]}-Preise ${city}: günstig vergleichen | wobillig` : `Kaffeepreise ${city}: günstige Cafés finden | wobillig`,
    description: type
      ? `${coffeeLabels[type]}-Preise in ${city} vergleichen: erfasste Preise in CHF, günstige Lokale, Adressen und Quellen. Finde dein Café auf der wobillig-Karte.`
      : `Günstigen Kaffee in ${city} finden: Espresso-, Cappuccino- und Café-crème-Preise vergleichen. Mit Karte, Preisquellen und weiteren Kaffee-, Bier- und Pizzapreisen.`,
    heading: type ? `${coffeeLabels[type]}-Preise in ${city}` : `Kaffeepreise in ${city} vergleichen`,
    path: type ? guidePath(cityId, type) : cities[cityId].path,
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

export function mapLink(cityId: City, type: string, base = '/', bar?: Bar) {
  const params = new URLSearchParams({ drink: 'coffee', coffeeType: type, sort: 'price', unknown: '0', max: 'all' });
  if (bar) params.set('bar', bar.id);
  return `${localPath(cities[cityId].path, base)}?${params}#app`;
}

function source(offer: Offer) {
  let url: URL;
  try { url = new URL(offer.sourceUrl); } catch { return 'Keine verlinkte Quelle'; }
  return /^https?:$/.test(url.protocol) ? `<a href="${e(url.href)}" rel="nofollow">Preisquelle</a>` : 'Keine verlinkte Quelle';
}

function priceTable(cityId: City, type: string, dataset: Dataset, limit: number, base: string) {
  const rows = coffeePrices(dataset, type).slice(0, limit);
  if (!rows.length) return '<p>Für diese Sorte sind noch keine vergleichbaren Preise erfasst.</p>';
  return `<div class="seo-table-wrap"><table><caption>${e(coffeeLabels[type])} in ${cities[cityId].name}: ${rows.length} der günstigsten erfassten Lokale</caption>
    <thead><tr><th scope="col">Lokal / Adresse</th><th scope="col">Preis</th><th scope="col">Quelle / erfasst am</th></tr></thead>
    <tbody>${rows.map(({ bar, offer }) => `<tr><td><a href="${e(mapLink(cityId, type, base, bar))}">${e(bar.name)}</a><small>${e([bar.address, bar.postcode, cities[cityId].name].filter(Boolean).join(', '))}</small></td><td>${money(offer.priceChf)}</td><td>${source(offer)}<small>${Number.isFinite(Date.parse(offer.observedAt)) ? dateLabel(offer.observedAt) : 'Datum unbekannt'} · ${offer.confidence === 'community' ? 'Community' : offer.confidence === 'reviewed' ? 'Manuell geprüft' : 'Automatisch erfasst'}</small></td></tr>`).join('')}</tbody>
  </table></div>`;
}

export function cityNavigation(base = '/') {
  return `<nav class="seo-links" aria-label="Kaffeepreise nach Stadt">${cityIds.map(id => `<a href="${localPath(cities[id].path, base)}">Kaffeepreise ${cities[id].name}</a>`).join('')}</nav>`;
}

function methodology(dataset: Dataset) {
  return `<section aria-labelledby="preisquellen"><h2 id="preisquellen">Woher stammen die Kaffeepreise?</h2>
    <p>Die Übersicht verwendet öffentlich zugängliche Getränkekarten und erfasste Preisangaben. Pro Lokal und Kaffeesorte zählt der günstigste passende Einzelpreis in CHF. Lokale ohne passenden Preis werden hier nicht mitgerechnet. Der Durchschnitt beschreibt die erfassten Lokale, nicht sämtliche Cafés der Stadt.</p>
    <p>Datenstand: <time datetime="${e(dataset.generatedAt)}">${dateLabel(dataset.generatedAt)}</time>. Die automatischen Daten werden planmässig alle drei Wochen aktualisiert. Das Erfassungsdatum zeigt, wann eine Quelle gelesen wurde; es garantiert keine neue Getränkekarte. Preise können sich ändern. Prüfe bei Bedarf die verlinkte Originalkarte.</p>
    <p>In der interaktiven Karte kannst du Preise ergänzen oder korrigieren. Neue Community-Einträge erscheinen dort laufend; diese Übersicht zeigt den Datenstand des letzten Website-Builds. Standortdaten: ${e(dataset.attribution)}.</p></section>`;
}

export function cityContent(cityId: City, dataset: Dataset, base = '/') {
  const city = cities[cityId].name;
  const summary = Object.entries(coffeeLabels).flatMap(([type, label]) => {
    const rows = coffeePrices(dataset, type);
    if (!rows.length) return [];
    const average = rows.reduce((sum, row) => sum + row.offer.priceChf, 0) / rows.length;
    const href = guideTypes.includes(type as GuideType) ? localPath(guidePath(cityId, type as GuideType), base) : mapLink(cityId, type, base);
    return [`<tr><th scope="row"><a href="${e(href)}">${e(label)}</a></th><td>${money(rows[0].offer.priceChf)}</td><td>${money(average)}</td><td>${rows.length}</td></tr>`];
  }).join('');
  return `<section id="kaffeepreise" class="seo-content" aria-labelledby="preisvergleich"><h1 id="preisvergleich">Kaffeepreise in ${city} vergleichen</h1><h2>Günstigen Kaffee in ${city} finden</h2>
    <p>Was kostet ein Espresso in ${city}? Wo gibt es günstigen Cappuccino? wobillig vergleicht erfasste Kaffeepreise in Cafés, Restaurants und Bars in ${city}. Wähle dieselbe Kaffeesorte, vergleiche den Preis pro Getränk und öffne das passende Lokal auf der Karte.</p>
    <div class="seo-table-wrap"><table><caption>Kaffeepreise ${city} nach Sorte – günstigster erfasster Preis und Durchschnitt</caption><thead><tr><th scope="col">Kaffeesorte</th><th scope="col">Ab</th><th scope="col">Durchschnitt</th><th scope="col">Lokale mit Preis</th></tr></thead><tbody>${summary}</tbody></table></div>
    ${guideTypes.map(type => `<section><h2>${coffeeLabels[type]}-Preise in ${city}</h2>${priceTable(cityId, type, dataset, 5, base)}<p><a href="${localPath(guidePath(cityId, type), base)}">${coffeeLabels[type]}-Preisvergleich ${city} mit weiteren Lokalen</a></p></section>`).join('')}
    <section><h2>Wie finde ich günstige Cafés in ${city}?</h2><p>Wähle auf der Karte Espresso, Cappuccino, Café crème oder eine andere Sorte und sortiere nach aufsteigendem Preis. Mit «Günstig» grenzt du die Auswahl auf die preiswerten erfassten Angebote ein. Adresse, Quelle und Erfassungsdatum helfen dir, das Angebot vor deinem Besuch einzuschätzen.</p><p><a href="${e(mapLink(cityId, 'cappuccino', base))}">Cappuccino auf der Karte vergleichen</a> · <a href="${e(mapLink(cityId, 'espresso', base))}">Espresso auf der Karte vergleichen</a></p></section>
    <section><h2>Weitere Preise in ${city}</h2><p>Auf wobillig kannst du auch Bierpreise nach Glasgrösse und Ausschankart vergleichen. Der Vergleich für Pizza Margherita wird freigeschaltet, sobald genügend Lokale mit Preisen erfasst sind.</p><a href="${localPath(cities[cityId].path, base)}?drink=beer#app">Bierpreise ${city} auf der Karte</a></section>
    ${methodology(dataset)}${cityNavigation(base)}</section>`;
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

export function seoHead(cityId: City, origin = siteOrigin, type?: GuideType) {
  const meta = metadata(cityId, type), url = origin + meta.path;
  const image = `${origin}/teaser/wobillig-teaser-${cityId === 'zurich' ? 'kreis1' : cityId}-1180.jpg`;
  const graph: object[] = [
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: 'wobillig', inLanguage: 'de-CH' },
    { '@type': 'CollectionPage', '@id': `${url}#webpage`, url, name: meta.title, description: meta.description, inLanguage: 'de-CH', isPartOf: { '@id': `${origin}/#website` }, about: { '@type': 'City', name: cities[cityId].name } },
  ];
  if (type) graph.push({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: `Kaffeepreise ${cities[cityId].name}`, item: origin + cities[cityId].path },
    { '@type': 'ListItem', position: 2, name: `${coffeeLabels[type]}-Preise`, item: url },
  ] });
  return `<title>${e(meta.title)}</title>
    <meta name="description" content="${e(meta.description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${e(url)}" />
    <meta property="og:type" content="website" /><meta property="og:locale" content="de_CH" />
    <meta property="og:site_name" content="wobillig" /><meta property="og:title" content="${e(meta.title)}" />
    <meta property="og:description" content="${e(meta.description)}" /><meta property="og:url" content="${e(url)}" />
    <meta property="og:image" content="${e(image)}" /><meta property="og:image:alt" content="wobillig – Preisvergleich auf der Karte für ${cities[cityId].name}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
}
