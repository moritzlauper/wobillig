import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { cities, cityFromPath, type City } from '../src/cities';
import type { Dataset } from '../src/data';
import { htmlLang, localeFromPath, locales, translate, type Locale } from '../src/i18n';
import { cityContent, cityIds, cityPath, guideContent, guidePath, guideTypes, localPath, seoHead, siteOrigin } from '../src/seo';

const root = fileURLToPath(new URL('../', import.meta.url));
const analyticsTag = '<script data-goatcounter="https://wobillig.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>';
const themeControl = (locale: Locale = 'de') => {
  const tr = (text: string) => translate(locale, text);
  return `<label class="theme-control" hidden>${tr('Design')} <select id="theme-select" aria-label="${tr('Farbschema')}"><option value="system">System</option><option value="light">${tr('Hell')}</option><option value="dark">${tr('Dunkel')}</option></select></label>`;
};
// Every map page in every language; the German Zürich page is the root.
const appPaths = cityIds.flatMap(city => locales.map(locale => cityPath(city, locale)));
export function seoPlugin(): Plugin {
  let base = '/';
  const themeHead = () => `<style>${readFileSync(`${root}src/theme.css`, 'utf8')}</style><script src="${localPath('/theme.js', base)}"></script>`;
  const origin = (process.env.SITE_URL || siteOrigin).replace(/\/$/, '');
  if (!/^https:\/\/[^/]+$/.test(origin)) throw new Error('SITE_URL must be an HTTPS origin without a path.');
  const dataset = (city: City): Dataset => JSON.parse(readFileSync(`${root}public/data/${cities[city].data}coffee.json`, 'utf8'));
  const guides = () => cityIds.flatMap(city => guideTypes.map(type => {
    const css = readFileSync(`${root}src/seo.css`, 'utf8');
    return {
      path: guidePath(city, type),
      html: `<!doctype html><html lang="de-CH"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="theme-color" content="#ffffff" />${themeHead()}${seoHead(city, origin, type)}<link rel="icon" href="${localPath('/favicon.svg', base)}" type="image/svg+xml" /><style>${css}</style>${analyticsTag}</head><body>${guideContent(city, type, dataset(city), base).replace('<header class="guide-header">', `<header class="guide-header">${themeControl()}`)}</body></html>`,
    };
  }));
  return {
    name: 'wobillig-static-seo',
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const page = '/' + relative(root, context.filename).replaceAll('\\', '/').replace(/index\.html$/, '');
        const city = cityFromPath(page), locale = localeFromPath(page);
        const other: Locale = locale === 'de' ? 'en' : 'de';
        const languageLink = `<a class="language-switch" data-locale="${other}" href="${localPath(cityPath(city, other), base)}" hreflang="${htmlLang[other]}" lang="${htmlLang[other]}">${other === 'en' ? 'English' : 'Deutsch'}</a>`;
        return html.replace('<!-- SEO_HEAD -->', `${themeHead()}${seoHead(city, origin, undefined, locale)}${analyticsTag}`)
          .replace('<!-- SEO_HEADING -->', `<header class="seo-map-header"><h1 id="map-title">${translate(locale, 'Kaffeepreise {city}', { city: translate(locale, cities[city].name) })}</h1>${languageLink}${themeControl(locale)}</header>`)
          .replace('<!-- SEO_CONTENT -->', cityContent(city, dataset(city), base, locale));
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/$/, '');
        if (appPaths.some(page => page !== '/' && localPath(page, base) === path)) {
          req.url = req.url!.replace(/^[^?]*/, `${path}/index.html`);
          return next();
        }
        if (!cityIds.some(city => guideTypes.some(type => localPath(guidePath(city, type), base) === path))) return next();
        const guide = guides().find(page => localPath(page.path, base) === path);
        if (!guide) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(guide.html);
      });
    },
    configurePreviewServer(server) {
      // Vite's SPA fallback does not apply Vercel rewrites. Mirror the declared
      // clean routes so local preview tests the actual built city/guide HTML.
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/$/, '');
        const routes = [...appPaths, ...cityIds.flatMap(city => guideTypes.map(type => guidePath(city, type)))];
        const route = routes.find(route => route !== '/' && localPath(route, base) === path);
        if (!route) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(resolve(server.config.root, server.config.build.outDir, `${route.slice(1)}/index.html`)));
      });
    },
    generateBundle() {
      for (const page of guides()) this.emitFile({ type: 'asset', fileName: `${page.path.slice(1)}/index.html`, source: page.html });
      const paths = [...appPaths, ...cityIds.flatMap(city => guideTypes.map(type => guidePath(city, type)))];
      // No invented lastmod: content and code can change independently of the data timestamp.
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>\n` });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n` });
    },
  };
}
