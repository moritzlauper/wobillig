import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { cities } from '../src/cities';
import { coffeePrices, cityIds, cityPath, guideContent, guidePath, guideTypes, metadata, siteOrigin } from '../src/seo';
import type { Dataset } from '../src/data';
import { locales } from '../src/i18n';

describe('search-engine-visible production pages', () => {
  const files = new Map<string, string>();
  beforeAll(async () => {
    const result = await build({ logLevel: 'silent', build: { write: false } });
    for (const output of (Array.isArray(result) ? result : [result])) {
      if (!('output' in output)) continue;
      for (const file of output.output) if (file.type === 'asset') files.set(file.fileName, String(file.source));
    }
  });

  it('ships unique titles, a single canonical and visible price content on all eighteen pages without JavaScript', () => {
    const titles = new Set<string>();
    const pages = cityIds.flatMap(city => locales.flatMap(locale =>
      [undefined, ...guideTypes].map(type => ({ meta: metadata(city, type, locale), source: locale === 'en' ? 'Price source</a>' : 'Preisquelle</a>' }))));
    for (const { meta, source } of pages) {
      const html = files.get(meta.path === '/' ? 'index.html' : `${meta.path.slice(1)}/index.html`)!;
      expect(html).toBeTruthy();
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html.match(/rel="canonical"/g)).toHaveLength(1);
      expect(html).toContain(`href="${siteOrigin}${meta.path}"`);
      expect(html).toContain(`<title>${meta.title}</title>`);
      expect(html).toContain('<table>');
      expect(html).toContain(source);
      expect(html).not.toContain('<!-- SEO_');
      expect(html).not.toContain('noindex');
      const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
      expect(data['@graph'].find((item: { '@type': string }) => item['@type'] === 'CollectionPage').url).toBe(siteOrigin + meta.path);
      titles.add(meta.title);
    }
    expect(titles.size).toBe(18);
  });

  it('serves each city map in English with language links in both directions', () => {
    const page = (path: string) => files.get(path === '/' ? 'index.html' : `${path.slice(1)}/index.html`)!;
    for (const city of cityIds) {
      const german = page(cityPath(city)), english = page(cityPath(city, 'en'));
      expect(german).toContain('<html lang="de-CH">');
      expect(english).toContain('<html lang="en">');
      for (const html of [german, english]) {
        expect(html).toContain(`<link rel="alternate" hreflang="de-CH" href="${siteOrigin}${cityPath(city)}" />`);
        expect(html).toContain(`<link rel="alternate" hreflang="en" href="${siteOrigin}${cityPath(city, 'en')}" />`);
        expect(html).toContain(`hreflang="x-default" href="${siteOrigin}${cityPath(city)}"`);
      }
      expect(german).toContain(`data-locale="en" href="${cityPath(city, 'en')}"`);
      expect(english).toContain(`data-locale="de" href="${cityPath(city)}"`);
      expect(english).toContain('<meta property="og:locale" content="en_GB" />');
      expect(english).toContain(`<h1 id="map-title">Coffee prices in ${city === 'zurich' ? 'Zurich' : cities[city].name}</h1>`);
      expect(english).toContain('aria-label="Colour scheme"');
      for (const type of guideTypes) {
        expect(english).not.toContain(`href="${guidePath(city, type)}"`);
        expect(english).toContain(`href="${guidePath(city, type, 'en')}"`);
      }
      expect(english).toContain(`href="${cityPath(city, 'en')}?drink=coffee&amp;coffeeType=espresso`);
      expect(english).not.toMatch(/Kaffeepreise|Lokale mit|Preisquelle|Datenstand/);
    }
  });

  it('translates every guide, its navigation and structured metadata with reciprocal language links', () => {
    for (const city of cityIds) for (const type of guideTypes) {
      const germanPath = guidePath(city, type), englishPath = guidePath(city, type, 'en');
      const german = files.get(`${germanPath.slice(1)}/index.html`)!;
      const english = files.get(`${englishPath.slice(1)}/index.html`)!;
      expect(english).toContain('<html lang="en">');
      expect(english).toContain(`<h1>${metadata(city, type, 'en').heading}</h1>`);
      expect(english).toContain('Which offers can be compared?');
      expect(english).toContain('Recorded prices range from');
      expect(english).toContain('Data as of');
      expect(english).toContain('aria-label="Breadcrumbs"');
      expect(english).toContain('aria-label="Colour scheme"');
      expect(english).not.toMatch(/Kaffeepreise|Lokale mit|Preisquelle|Datenstand|Brotkrümel|Welche Angebote|Durchschnitt|Massgeblich/);
      expect(german).toContain(`data-locale="en" href="${englishPath}"`);
      expect(english).toContain(`data-locale="de" href="${germanPath}"`);
      for (const html of [german, english]) {
        expect(html).toContain(`hreflang="de-CH" href="${siteOrigin}${germanPath}"`);
        expect(html).toContain(`hreflang="en" href="${siteOrigin}${englishPath}"`);
        expect(html).toContain(`hreflang="x-default" href="${siteOrigin}${germanPath}"`);
      }
      for (const [, href] of english.matchAll(/<a[^>]*href="([^"]+)"/g)) {
        if (href.startsWith('/') && href !== germanPath) expect(href).toMatch(/^\/en(?:\/|\?|$)/);
      }
      const data = JSON.parse(english.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
      expect(data['@graph'].find((item: { '@type': string }) => item['@type'] === 'CollectionPage').inLanguage).toBe('en');
      const crumbs = data['@graph'].find((item: { '@type': string }) => item['@type'] === 'BreadcrumbList').itemListElement;
      expect(crumbs[0].item).toBe(siteOrigin + cityPath(city, 'en'));
      expect(crumbs[0].name).toMatch(/^Coffee prices in /);
      expect(crumbs[1].name).toMatch(/ prices$/);
    }
  });

  it('lists only canonical pages in the sitemap and gives every guide a deployed route and incoming city link', () => {
    const sitemap = files.get('sitemap.xml')!;
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(sitemap.match(/<loc>/g)).toHaveLength(18);
    for (const [, url] of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) expect(new URL(url).search).toBe('');
    expect(files.get('robots.txt')).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);
    for (const city of cityIds) {
      const english = cityPath(city, 'en');
      expect(sitemap).toContain(`<loc>${siteOrigin}${english}</loc>`);
      expect(config.rewrites).toContainEqual({ source: english, destination: `${english}/index.html` });
      expect(config.redirects).toContainEqual({ source: `${english}/index.html`, destination: english, permanent: true });
      for (const locale of locales) for (const type of guideTypes) {
        const homePath = cityPath(city, locale);
        const home = files.get(homePath === '/' ? 'index.html' : `${homePath.slice(1)}/index.html`)!;
        const path = guidePath(city, type, locale);
        expect(home).toContain(`href="${path}"`);
        expect(sitemap).toContain(`<loc>${siteOrigin}${path}</loc>`);
        expect(config.rewrites).toContainEqual({ source: path, destination: `${path}/index.html` });
        expect(config.redirects).toContainEqual({ source: `${path}/index.html`, destination: path, permanent: true });
        const guide = files.get(`${path.slice(1)}/index.html`)!;
        expect(guide).toContain(`coffeeType=${type}`);
        expect(guide).toContain(`href="${homePath}"`);
      }
    }
  });

  it('uses the same source data as the map and keeps city totals separate', () => {
    for (const city of cityIds) {
      const dataset: Dataset = JSON.parse(readFileSync(`public/data/${cities[city].data}coffee.json`, 'utf8'));
      for (const type of guideTypes) {
        const prices = coffeePrices(dataset, type);
        const html = files.get(`${guidePath(city, type).slice(1)}/index.html`)!;
        const english = files.get(`${guidePath(city, type, 'en').slice(1)}/index.html`)!;
        expect(html).toContain(`${prices.length} Lokale mit`);
        expect(html).toContain(`ab CHF ${prices[0].offer.priceChf.toFixed(2)}`);
        expect(english).toContain(`${prices.length} venues with a`);
        expect(english).toContain(`from CHF ${prices[0].offer.priceChf.toFixed(2)}`);
      }
    }
  });
});

describe('static price selection', () => {
  const original: Dataset = JSON.parse(readFileSync('public/data/coffee.json', 'utf8'));
  const offer = original.bars.flatMap(bar => bar.offers).find(offer => offer.coffeeType === 'espresso')!;
  const bar = { ...original.bars[0], type: 'cafe', offers: [offer] };

  it('counts each eligible venue once and excludes wrong sorts, invalid prices, fast food and expired photo prices', () => {
    const dataset: Dataset = { ...original, bars: [
      { ...bar, id: 'valid', offers: [{ ...offer, priceChf: 5 }, { ...offer, priceChf: 4 }, { ...offer, coffeeType: 'double', priceChf: 1 }] },
      { ...bar, type: 'fast_food' },
      { ...bar, offers: [{ ...offer, priceChf: NaN }, { ...offer, priceChf: 0 }] },
      { ...bar, offers: [{ ...offer, photoSource: { kind: 'google_maps_photo', date: '2020-01-01', dateEvidence: '', dateCheckedAt: '', validUntil: '' } }] },
    ] };
    const prices = coffeePrices(dataset, 'espresso', '2026-10-16');
    expect(prices).toHaveLength(1);
    expect(prices[0].offer.priceChf).toBe(4);
  });

  it('escapes source text and rejects unsafe source links while retaining subpath navigation', () => {
    const dataset: Dataset = { ...original, bars: [{ ...bar, name: '<script>alert(1)</script>', offers: [{ ...offer, sourceUrl: 'javascript:alert(1)' }] }] };
    const html = guideContent('basel', 'espresso', dataset, '/wobillig/');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="/wobillig/basel?');
    expect(html).toContain('href="/wobillig/espresso-bern"');
    const english = guideContent('basel', 'espresso', dataset, '/wobillig/', 'en');
    expect(english).toContain('href="/wobillig/en/basel?');
    expect(english).toContain('href="/wobillig/en/espresso-bern"');
    expect(english).toContain('href="/wobillig/espresso-basel"');
    expect(english).toContain('No linked source');
    expect(english).not.toContain('<script>');
  });

  it('translates empty guide states as well as populated tables', () => {
    for (const type of guideTypes) {
      const html = guideContent('zurich', type, { ...original, bars: [] }, '/', 'en');
      expect(html).toContain('No comparable prices have been recorded yet.');
      expect(html).toContain('The price range and average will appear here once matching prices are available.');
      expect(html).not.toMatch(/Noch keine|Sobald passende|Für diese Sorte/);
    }
  });
});
