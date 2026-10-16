import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { readFileSync } from 'node:fs';
import { cities } from '../src/cities';
import { coffeePrices, cityIds, guideContent, guidePath, guideTypes, metadata, siteOrigin } from '../src/seo';
import type { Dataset } from '../src/data';

describe('search-engine-visible production pages', () => {
  const files = new Map<string, string>();
  beforeAll(async () => {
    const result = await build({ logLevel: 'silent', build: { write: false } });
    for (const output of (Array.isArray(result) ? result : [result])) {
      if (!('output' in output)) continue;
      for (const file of output.output) if (file.type === 'asset') files.set(file.fileName, String(file.source));
    }
  });

  it('ships unique titles, a single canonical and visible price content on all nine pages without JavaScript', () => {
    const titles = new Set<string>();
    for (const city of cityIds) {
      for (const type of [undefined, ...guideTypes]) {
        const meta = metadata(city, type);
        const html = files.get(meta.path === '/' ? 'index.html' : `${meta.path.slice(1)}/index.html`)!;
        expect(html).toBeTruthy();
        expect(html.match(/<h1[ >]/g)).toHaveLength(1);
        expect(html.match(/rel="canonical"/g)).toHaveLength(1);
        expect(html).toContain(`href="${siteOrigin}${meta.path}"`);
        expect(html).toContain(`<title>${meta.title}</title>`);
        expect(html).toContain('<table>');
        expect(html).toContain('Preisquelle</a>');
        expect(html).not.toContain('<!-- SEO_');
        expect(html).not.toContain('noindex');
        const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
        expect(data['@graph'].find((item: { '@type': string }) => item['@type'] === 'CollectionPage').url).toBe(siteOrigin + meta.path);
        titles.add(meta.title);
      }
    }
    expect(titles.size).toBe(9);
  });

  it('lists only canonical pages in the sitemap and gives every guide a deployed route and incoming city link', () => {
    const sitemap = files.get('sitemap.xml')!;
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(sitemap.match(/<loc>/g)).toHaveLength(9);
    for (const [, url] of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) expect(new URL(url).search).toBe('');
    expect(files.get('robots.txt')).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);
    for (const city of cityIds) {
      const home = files.get(city === 'zurich' ? 'index.html' : `${city}/index.html`)!;
      for (const type of guideTypes) {
        const path = guidePath(city, type);
        expect(home).toContain(`href="${path}"`);
        expect(sitemap).toContain(`<loc>${siteOrigin}${path}</loc>`);
        expect(config.rewrites).toContainEqual({ source: path, destination: `${path}/index.html` });
        const guide = files.get(`${path.slice(1)}/index.html`)!;
        expect(guide).toContain(`coffeeType=${type}`);
        expect(guide).toContain(`href="${cities[city].path}"`);
      }
    }
  });

  it('uses the same source data as the map and keeps city totals separate', () => {
    for (const city of cityIds) {
      const dataset: Dataset = JSON.parse(readFileSync(`public/data/${cities[city].data}coffee.json`, 'utf8'));
      for (const type of guideTypes) {
        const prices = coffeePrices(dataset, type);
        const html = files.get(`${guidePath(city, type).slice(1)}/index.html`)!;
        expect(html).toContain(`${prices.length} Lokale mit`);
        expect(html).toContain(`ab CHF ${prices[0].offer.priceChf.toFixed(2)}`);
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
  });
});
