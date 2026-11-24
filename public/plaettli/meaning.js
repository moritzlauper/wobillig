// Short meanings for the in-game dictionary, from Wiktionary (CC BY-SA 4.0).
// The browser asks Wiktionary directly (both endpoints allow cross-site requests), only for
// words that are in the game's word list, and keeps the answers for the rest of the visit.
const HEADERS = { 'Api-User-Agent': 'Plaettli word game (https://wobillig.ch/plaettli/)' };
const MAX = 160;
const cache = new Map();

/** { title, url, note, parts: [{ pos, defs: [string] }] } or null when Wiktionary has nothing. */
export function meaning(lang, word) {
  const key = `${lang}:${word}`;
  if (!cache.has(key)) {
    cache.set(key, (lang === 'de' ? german(word) : english(word)).catch((e) => {
      cache.delete(key); // network trouble or rate limit: try again next time
      throw e;
    }));
  }
  return cache.get(key);
}

const shorten = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s);
const wikiUrl = (lang, title) => `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;

// ---------- English: the REST definitions endpoint ----------
function htmlText(html) {
  const s = String(html ?? '');
  if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(s, 'text/html').body.textContent || '';
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
export function englishParts(json) {
  const all = Array.isArray(json?.en) ? json.en : [];
  return all.filter((e) => e?.language === 'English').slice(0, 2).map((e) => ({
    pos: String(e.partOfSpeech || ''),
    defs: (Array.isArray(e.definitions) ? e.definitions : [])
      .map((d) => shorten(htmlText(d?.definition).replace(/\s+/g, ' ').trim()))
      .filter(Boolean).slice(0, 2),
  })).filter((p) => p.defs.length);
}
async function english(word) {
  const title = word.toLowerCase();
  const r = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(title)}`, { headers: HEADERS });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`wiktionary ${r.status}`);
  const parts = englishParts(await r.json());
  return parts.length ? { title, url: `${wikiUrl('en', title)}#English`, note: '', parts } : null;
}

// ---------- German: page source from the REST API, read for {{Bedeutungen}} ----------
export function cleanWikitext(line) {
  let t = String(line);
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '');
  t = t.replace(/\{\{K\|([^{}]*)\}\}/g, (_, args) => {
    const labels = args.split('|').filter((a) => a && !a.includes('='));
    return labels.length ? `(${labels.join(', ')})` : '';
  });
  for (let i = 0; i < 6 && t.includes('{{'); i++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => (inner.includes('|') ? '' : inner)); // {{ugs.}} stays, others go
  }
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim();
  return shorten(t);
}
const block = (text, name) => {
  const m = new RegExp(`\\{\\{${name}\\}\\}\\n([\\s\\S]*?)(?:\\n\\s*\\n|\\n\\{\\{|$)`).exec(text);
  return m ? m[1].split('\n') : null;
};

/** Reads the German section of a de.wiktionary page: meanings, or for an inflected form or a
 *  Swiss spelling a note and the base form to look up instead. */
export function parseGerman(source) {
  const src = String(source ?? '');
  const redirect = /^#(?:WEITERLEITUNG|REDIRECT)\s*\[\[([^\]|#]+)/i.exec(src);
  if (redirect) return { parts: [], base: redirect[1].trim(), note: '' };
  const start = src.search(/^==[^=].*\{\{Sprache\|Deutsch\}\}/m);
  if (start < 0) return null;
  let section = src.slice(start);
  const end = section.slice(2).search(/^==[^=]/m);
  if (end >= 0) section = section.slice(0, end + 2);

  const parts = [];
  let base = null, note = '';
  const swiss = /\{\{Schweizer und Liechtensteiner Schreibweise\|([^|}]+)/.exec(section);
  if (swiss) { base = swiss[1].trim(); note = `Schweizer Schreibweise von ${base}`; }
  for (const chunk of section.split(/^=== /m).slice(1)) {
    const pos = /\{\{Wortart\|([^|}]+)/.exec(chunk)?.[1]?.trim() || '';
    const meanings = block(chunk, 'Bedeutungen');
    if (meanings) {
      const defs = meanings.filter((l) => /^:+\s*\[/.test(l)).map((l) => cleanWikitext(l.replace(/^:+\s*\[[^\]]*\]\s*/, ''))).filter(Boolean).slice(0, 3);
      if (defs.length) parts.push({ pos, defs });
    } else {
      const grammar = block(chunk, 'Grammatische Merkmale');
      const first = grammar?.find((l) => l.startsWith('*'));
      if (first && !note) note = cleanWikitext(first.replace(/^\*+\s*/, ''));
      const ref = /\{\{Grundformverweis[^|}]*\|([^|}]+)/.exec(chunk);
      if (ref && !base) base = ref[1].trim();
    }
  }
  // meanings found: drop notes from other sections of the page (e.g. "Haus" is also a form of "Hau")
  return parts.length ? { parts: parts.slice(0, 2), base: null, note: swiss ? note : '' } : { parts, base, note };
}

async function dePage(title) {
  const r = await fetch(`https://de.wiktionary.org/w/rest.php/v1/page/${encodeURIComponent(title)}`, { headers: HEADERS });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`wiktionary ${r.status}`);
  const j = await r.json();
  return typeof j?.source === 'string' ? { title: String(j.title || title), source: j.source } : null;
}
async function german(word) {
  const capital = word[0] + word.slice(1).toLowerCase();
  for (const title of [capital, word.toLowerCase()]) { // nouns are capitalised on Wiktionary
    const page = await dePage(title);
    const info = page && parseGerman(page.source);
    if (!info) continue;
    let { parts } = info;
    if (!parts.length && info.base) { // inflected form, Swiss spelling or redirect: explain the base form
      const basePage = await dePage(info.base);
      parts = (basePage && parseGerman(basePage.source)?.parts) || [];
    }
    if (parts.length || info.note) return { title: page.title, url: wikiUrl('de', page.title), note: info.note, parts };
  }
  return null;
}
