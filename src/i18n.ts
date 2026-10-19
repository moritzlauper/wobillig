import { en } from './i18n-en.js';

export type Locale = 'de' | 'en';
export const locales: Locale[] = ['de', 'en'];
export const htmlLang: Record<Locale, string> = { de: 'de-CH', en: 'en' };
const dateLocales: Record<Locale, string> = { de: 'de-CH', en: 'en-GB' };

// The German text is the translation key (gettext style). The browser takes the
// locale from <html lang>, which the build sets per page; Node code stays German.
let current: Locale = typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? 'en' : 'de';

export function locale(): Locale { return current; }
export function dateLocale(target = current): string { return dateLocales[target]; }

export function localeFromPath(path: string, base = '/'): Locale {
  const relative = path.startsWith(base) ? path.slice(base.length) : path;
  return /^\/*en(?:\/|$)/.test(relative) ? 'en' : 'de';
}
export function localizedPath(path: string, target: Locale): string {
  return target === 'en' ? `/en${path === '/' ? '' : path}` : path;
}

export function translate(target: Locale, text: string, vars: Record<string, string | number> = {}): string {
  const template = target === 'en' ? en[text] ?? text : text;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(vars, key) ? String(vars[key]) : match);
}
export function t(text: string, vars?: Record<string, string | number>): string {
  return translate(current, text, vars);
}
