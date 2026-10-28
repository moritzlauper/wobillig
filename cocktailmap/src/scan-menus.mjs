// Sucht auf den Websites der Bars nach Cocktailnamen aus src/cocktails.mjs.
// Es werden nur die Startseite, eine hinterlegte Karten-URL (website:menu) und
// höchstens drei Unterseiten mit Karte-, Menü- oder Drinks-Links gelesen.
// robots.txt wird beachtet. Ergebnis: raw/menus.json
// Aufruf: node src/scan-menus.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COCKTAILS } from "./cocktails.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "raw");
const USER_AGENT = "wobillig-cocktailmap/1.0 (Cocktailkarte Zürich, Abgleich öffentlicher Karten)";
const CONCURRENCY = 4;
const MAX_SUBPAGES = 3;
const MENU_LINK = /karte|menu|menü|cocktail|drink|getr[aä]nk|carte/i;

const patterns = COCKTAILS.map((cocktail) => ({
  id: cocktail.id,
  regex: new RegExp(
    `(?<!\\p{L})(${cocktail.aliases.map(escapeRegex).join("|")})s?(?!\\p{L})`,
    "iu",
  ),
}));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme);
}

function parseRobots(text) {
  const rules = [];
  let appliesToAll = false;
  for (const line of text.split(/\r?\n/)) {
    const clean = line.split("#")[0].trim();
    const separator = clean.indexOf(":");
    if (separator === -1) continue;
    const key = clean.slice(0, separator).trim().toLowerCase();
    const value = clean.slice(separator + 1).trim();
    if (key === "user-agent") appliesToAll = value === "*";
    else if (appliesToAll && (key === "allow" || key === "disallow")) {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  return rules;
}

function isAllowed(rules, path) {
  let best = { allow: true, length: -1 };
  for (const rule of rules) {
    if (rule.path && path.startsWith(rule.path) && rule.path.length > best.length) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  return best.allow;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  if (!(response.headers.get("content-type") || "").includes("text")) return null;
  return { url: response.url, html: (await response.text()).slice(0, 2_000_000) };
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;|&#8217;/g, "'")
    .replace(/\s+/g, " ");
}

function menuLinks(html, base) {
  const found = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = match[2].replace(/<[^>]+>/g, " ");
    if (!MENU_LINK.test(match[1]) && !MENU_LINK.test(text)) continue;
    try {
      const url = new URL(match[1], base);
      if (url.host.replace(/^www\./, "") !== base.host.replace(/^www\./, "")) continue;
      url.hash = "";
      found.add(url.href);
    } catch {
      // Ungültige Links werden übersprungen.
    }
  }
  return [...found].slice(0, MAX_SUBPAGES);
}

async function scanBar(bar, robotsCache) {
  const website = bar.tags.website || bar.tags["contact:website"] || bar.tags["website:menu"];
  if (!website) return { status: "keine_website", matches: [] };

  let start;
  try {
    start = normalizeUrl(website);
  } catch {
    return { status: "ungueltige_url", website, matches: [] };
  }

  const origin = start.origin;
  if (!robotsCache.has(origin)) {
    try {
      const robots = await fetchText(`${origin}/robots.txt`);
      robotsCache.set(origin, parseRobots(robots?.html ?? ""));
    } catch {
      robotsCache.set(origin, []);
    }
  }
  const rules = robotsCache.get(origin);
  const allowed = (url) => isAllowed(rules, new URL(url).pathname);

  const queue = [start.href];
  if (bar.tags["website:menu"]) queue.push(bar.tags["website:menu"]);
  const seen = new Set();
  const matches = new Map();
  let fetched = 0;
  let blocked = 0;

  const visit = async (url) => {
    if (seen.has(url)) return null;
    seen.add(url);
    if (!allowed(url)) {
      blocked += 1;
      return null;
    }
    try {
      const page = await fetchText(url);
      if (page) fetched += 1;
      return page;
    } catch {
      return null;
    }
  };

  for (let index = 0; index < queue.length; index += 1) {
    const page = await visit(queue[index]);
    if (!page) continue;
    const text = visibleText(page.html);
    for (const { id, regex } of patterns) {
      if (!matches.has(id) && regex.test(text)) matches.set(id, page.url);
    }
    if (index === 0) {
      for (const link of menuLinks(page.html, new URL(page.url))) queue.push(link);
    }
  }

  const status = fetched === 0 ? (blocked > 0 ? "robots" : "fehler") : matches.size > 0 ? "treffer" : "keine_treffer";
  return {
    status,
    website: start.href,
    matches: [...matches].map(([cocktail, url]) => ({ cocktail, url })),
  };
}

const bars = JSON.parse(await readFile(join(rawDir, "bars.json"), "utf8")).elements;
const robotsCache = new Map();
const results = {};
let next = 0;

async function worker() {
  while (next < bars.length) {
    const bar = bars[next];
    next += 1;
    const key = `${bar.type}/${bar.id}`;
    try {
      results[key] = { ...(await scanBar(bar, robotsCache)), scannedAt: new Date().toISOString() };
    } catch (error) {
      results[key] = { status: "fehler", matches: [], error: error.message, scannedAt: new Date().toISOString() };
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await writeFile(join(rawDir, "menus.json"), JSON.stringify(results, null, 2));

const counts = Object.values(results).reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify(counts));
