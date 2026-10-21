import { translate, type Locale } from './i18n.js';

export const legalPaths = (locale: Locale) => locale === 'en'
  ? { imprint: '/en/imprint', privacy: '/en/privacy' }
  : { imprint: '/impressum', privacy: '/datenschutz' };

export function legalLinks(locale: Locale, base = '/') {
  const paths = legalPaths(locale);
  const prefix = base.replace(/\/$/, '');
  return `<a class="legal-link" href="${prefix}${paths.imprint}">${translate(locale, 'Impressum')}</a><a class="legal-link" href="${prefix}${paths.privacy}">${translate(locale, 'Datenschutz')}</a>`;
}
