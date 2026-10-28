#!/usr/bin/env node
/**
 * Kinopreise Zürich: sucht die Eintrittspreise auf den Websites der Kinos.
 *
 * Pro Kino wird die Startseite abgerufen und nach Links auf Preis- und Ticketseiten durchsucht.
 * Auf diesen Seiten werden alle Zeilen mit "CHF" eingesammelt, mit dem Text davor als Bezeichnung
 * und einer Kategorie (normal, ermaessigt, jugend, aktion, sonstige). So sind die Kinos vergleichbar,
 * auch wenn jede Website ihre Preise anders beschriftet.
 *
 * Ausgabe: scripts/kino-zuerich.json mit allen gefundenen Zeilen und dem Abrufdatum. Der Vergleich
 * (günstigster Preis je Kategorie) geht als Markdown auf stdout, der Workflow leitet ihn in die
 * GitHub-Actions-Zusammenfassung.
 *
 *   node scripts/kino-preise.mjs [scripts/kino-zuerich.json]
 *
 * Kinos, deren Website kein Preis liefert (z. B. weil die Seite per JavaScript lädt), erscheinen
 * mit Status statt still zu fehlen. Der Lauf schlägt nur fehl, wenn kein einziges Kino Preise liefert.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hier = dirname(fileURLToPath(import.meta.url))
const UA = 'wobillig-kino/1.0 (+https://wobillig.ch)'
// Tiefer Scan (KINO_TIEFE=tief) liest bis zu zehn Unterseiten je Kino statt drei.
const TIEF = process.env.KINO_TIEFE === 'tief'
const MAX_SEITEN = TIEF ? 10 : 3
// KI-Budget in USD. Ohne Budget (0) oder ohne ANTHROPIC_API_KEY liest der Lauf nur per Regex.
const KI_BUDGET_USD = Number(process.env.KI_BUDGET_USD) || 0
let kiAusgegeben = 0

export const KINOS = [
  { name: 'Filmpodium', url: 'https://www.filmpodium.ch/' },
  { name: 'Xenix', url: 'https://www.xenix.ch/' },
  { name: 'Arthouse Kinos', url: 'https://arthouse.ch/' },
  { name: 'KinoKoni', url: 'https://kinokoni.ch/' },
  { name: 'Riffraff und Houdini', url: 'https://www.riffraff-houdini.ch/de-ch/programm.html' },
  { name: 'blue Cinema (Abaton, Corso, Metropol)', url: 'https://www.bluecinema.ch/de' },
]

const PREIS_LINK = /preis|tarif|eintritt|ticket|abo/i
const KEIN_LINK = /\/tickets\/\d+|\.(pdf|jpe?g|png|gif|svg)$|impressum|datenschutz|agb|newsletter/i
const CHF = /CHF\s*(\d{1,3})(?:[.,](\d{2}|–|-))?/g
const KATEGORIEN = ['normal', 'ermaessigt', 'jugend', 'aktion']

// Reihenfolge zählt: "Kulturlegi" soll als Jugend gelten, nicht als Legi (ermäßigt).
const REGELN = [
  ['jugend', /kultur|unter 25|under 25|kind|child|jugend|youth|schul/i],
  ['aktion', /montag|dienstag|mittwoch|donnerstag|freitag|kinotag|monday|tuesday|wednesday|thursday|discount|aktion/i],
  ['ermaessigt', /ahv|\biv\b|legi|student|senior|halbtax|half-price|reduz|reduced|erm[aä]ss|rentner/i],
  ['normal', /regul|normal|erwachsen|adult|vollpreis|regular|standard|eintritt/i],
]

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  eacute: 'é', egrave: 'è', agrave: 'à', szlig: 'ß',
}

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (treffer, code) => {
    if (code[0] === '#') {
      const zahl = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return String.fromCodePoint(zahl)
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? treffer
  })
}

// HTML zu lesbarem Text mit Zeilenumbrüchen an Blockgrenzen, damit Bezeichnungen nicht zusammenlaufen.
export function textOf(html) {
  const ohne = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|tr|h\d|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(ohne)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

// Zugeordnet wird nur das Ende der Bezeichnung, dort steht das Wort vor dem Preis
// ("Regulärer Eintrittspreis", "AHV und Legi"). Davor steht oft Navigation oder Fließtext.
export function kategorie(bezeichnung) {
  const ende = bezeichnung.slice(-50)
  for (const [name, muster] of REGELN) if (muster.test(ende)) return name
  return 'sonstige'
}

// Liest alle "Bezeichnung: CHF xx" Zeilen aus dem Text. Der Text zwischen zwei CHF-Angaben
// gehört zur zweiten, die Bezeichnung ist alles nach dem letzten Doppelpunkt davor.
export function preiseAus(text) {
  const funde = []
  const gesehen = new Set()
  let ende = 0
  for (const treffer of text.matchAll(CHF)) {
    const segment = text.slice(ende, treffer.index)
    ende = treffer.index + treffer[0].length

    // Letzter nichtleerer Teil vor dem CHF, danach nur der letzte Satz davon.
    const teile = segment.split(':').map((teil) => teil.replace(/\s+/g, ' ').trim()).filter(Boolean)
    let bezeichnung = (teile.at(-1) ?? '').split(/[.!?]\s+/).at(-1) ?? ''
    if (!bezeichnung) bezeichnung = segment.slice(-60).replace(/\s+/g, ' ').trim()
    if (bezeichnung.length > 80) bezeichnung = bezeichnung.slice(-80).replace(/^\S*\s/, '')

    const cents = treffer[2] && /^\d{2}$/.test(treffer[2]) ? Number(treffer[2]) / 100 : 0
    const preis = Number(treffer[1]) + cents
    if (preis < 1 || preis > 500) continue

    const eintrag = { kategorie: kategorie(bezeichnung), bezeichnung, preis, methode: 'regex' }
    const schluessel = `${eintrag.kategorie}|${bezeichnung}|${preis}`
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    funde.push(eintrag)
  }
  return funde
}

// Interne Links derselben Website, die nach Preisen oder Tickets aussehen. Preisseiten zuerst.
export function preisLinks(html, basis) {
  const host = new URL(basis).host
  const gefunden = new Set()
  for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"#]+)"/gi)) {
    let url
    try {
      url = new URL(decodeEntities(href), basis)
    } catch {
      continue
    }
    if (url.host !== host) continue
    if (KEIN_LINK.test(url.pathname) || !PREIS_LINK.test(url.pathname + url.search)) continue
    url.hash = ''
    gefunden.add(url.href)
  }
  return [...gefunden].sort((a, b) => rang(a) - rang(b))
}

function rang(url) {
  return /preis|tarif|eintritt/i.test(url) ? 0 : 1
}

// robots.txt gilt pro Host und nur für die Gruppe "*". Das Skript nennt sich nicht eigens als Crawler.
const robots = new Map()

export function regelnAus(text) {
  const regeln = []
  let gilt = false
  for (const zeile of text.split(/\r?\n/)) {
    const [feld, ...rest] = zeile.replace(/#.*/, '').split(':')
    const wert = rest.join(':').trim()
    if (/^user-agent$/i.test(feld.trim())) gilt = wert === '*'
    else if (gilt && /^disallow$/i.test(feld.trim()) && wert) regeln.push(wert)
  }
  return regeln
}

async function erlaubt(url) {
  const { origin, pathname } = new URL(url)
  if (!robots.has(origin)) {
    const antwort = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
    robots.set(origin, antwort?.ok ? regelnAus(await antwort.text()) : [])
  }
  return !robots.get(origin).some((regel) => pathname.startsWith(regel))
}

// Mindestens eine Sekunde zwischen zwei Abrufen, die Seiten werden nacheinander gelesen.
async function abrufen(url) {
  if (!(await erlaubt(url))) throw new Error('robots.txt verbietet den Abruf')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const antwort = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'de-CH,de;q=0.9' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`)
  return antwort.text()
}

const KI_MODELL = 'claude-haiku-5-5'
const KI_MAX_ZEICHEN = 30000

// Gedankenstriche und Leerraum vereinheitlichen, damit Belegzitate trotz Schreibweise gefunden werden.
function vergleichbar(text) {
  return text.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
}

// Übernimmt nur Preise, deren Belegzitat wörtlich auf der Seite steht. So fällt ein von der KI
// erfundener Preis heraus, auch wenn er plausibel klingt.
export function kiFundePruefen(antwort, text) {
  const seite = vergleichbar(text)
  const funde = []
  for (const eintrag of antwort) {
    const zitat = vergleichbar(String(eintrag?.belegzitat ?? ''))
    const preis = Number(eintrag?.preis)
    if (!zitat || !seite.includes(zitat)) continue
    if (!Number.isFinite(preis) || preis < 1 || preis > 500) continue
    funde.push({
      kategorie: KATEGORIEN.includes(eintrag.kategorie) ? eintrag.kategorie : 'sonstige',
      bezeichnung: String(eintrag.bezeichnung ?? '').slice(0, 160),
      preis,
      methode: 'ki',
    })
  }
  return funde
}

function kiAufgabe(kino, text) {
  return [
    `Du bekommst den Text der Website eines Zürcher Kinos (${kino}).`,
    'Finde alle Eintrittspreise für einzelne Vorstellungen: Normalpreis, Ermässigungen (AHV, IV, Legi, Studierende),',
    'Jugendpreise (Kinder, unter 25, Kulturlegi) und Aktionen für bestimmte Tage oder Angebote.',
    'Abos, Gutscheine, Aufladungen, Ausstellgebühren und Bundles lässt du weg.',
    'Antworte nur mit einem JSON-Array ohne weiteren Text. Jedes Element hat diese Felder:',
    '{"kategorie": "normal" | "ermaessigt" | "jugend" | "aktion" | "sonstige", "bezeichnung": "Bezeichnung wie auf der Seite",',
    '"preis": Zahl in CHF, "belegzitat": "der Ausschnitt aus dem Text, in dem der Preis steht, wörtlich kopiert"}.',
    'Findest du keine Eintrittspreise, antworte mit [].',
    '',
    'Text:',
    text.slice(0, KI_MAX_ZEICHEN),
  ].join('\n')
}

// Preise je Million Token wie in scraper/ai.py. Die Reserve rechnet mit dem höheren Satz.
const EINGABE_PREIS = 0.10
const AUSGABE_PREIS = 0.50
const GROSSE_EINGABE_PREIS = 0.50
const GROSSE_AUSGABE_PREIS = 2.50
const GRENZE_EINGABE_TOKEN = 100_000
const MAX_AUSGABE_TOKEN = 2000

export function kiKosten(usage) {
  const eingabe = usage.input_tokens ?? 0
  const ausgabe = usage.output_tokens ?? 0
  const [preisEingabe, preisAusgabe] = eingabe <= GRENZE_EINGABE_TOKEN ? [EINGABE_PREIS, AUSGABE_PREIS] : [GROSSE_EINGABE_PREIS, GROSSE_AUSGABE_PREIS]
  return (eingabe * preisEingabe + ausgabe * preisAusgabe) / 1_000_000
}

export function kiReserve(aufgabe) {
  // Ein Token entspricht grob drei Zeichen, damit die Reserve auch bei deutschem Text reicht.
  const eingabe = Math.ceil(aufgabe.length / 3)
  return (eingabe * GROSSE_EINGABE_PREIS + MAX_AUSGABE_TOKEN * GROSSE_AUSGABE_PREIS) / 1_000_000
}

// Fragt die Claude-API nach den Preisen einer Seite. Wirft bei Fehlern, der Aufrufer fällt dann auf den Regex zurück.
export async function kiPreise(text, kino, schluessel) {
  const aufgabe = kiAufgabe(kino, text)
  if (kiAusgegeben + kiReserve(aufgabe) > KI_BUDGET_USD) throw new Error('KI-Budget erschöpft')
  const antwort = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': schluessel,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: KI_MODELL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: aufgabe }],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!antwort.ok) throw new Error(`KI-API HTTP ${antwort.status}`)

  const daten = await antwort.json()
  kiAusgegeben += kiKosten(daten.usage ?? {})
  const inhalt = (daten.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
  const array = inhalt.match(/\[[\s\S]*\]/)
  if (!array) return []
  return kiFundePruefen(JSON.parse(array[0]), text)
}

async function pruefen(kino, geprueft) {
  const seiten = []
  const fehler = []
  let hauptseite
  try {
    hauptseite = await abrufen(kino.url)
  } catch (fehlerObjekt) {
    return { name: kino.name, quelle: kino.url, geprueft, status: `Abruf fehlgeschlagen: ${fehlerObjekt.message}`, seiten: [], preise: [] }
  }

  const unterseiten = preisLinks(hauptseite, kino.url).slice(0, MAX_SEITEN)
  const texte = [{ url: kino.url, html: hauptseite }]
  for (const url of unterseiten) {
    try {
      texte.push({ url, html: await abrufen(url) })
    } catch (fehlerObjekt) {
      fehler.push(`${url}: ${fehlerObjekt.message}`)
    }
  }

  const schluessel = process.env.ANTHROPIC_API_KEY
  const preise = []
  for (const { url, html } of texte) {
    const text = textOf(html)
    let funde = null
    if (schluessel && KI_BUDGET_USD > 0) {
      try {
        funde = await kiPreise(text, kino.name, schluessel)
      } catch (fehlerObjekt) {
        fehler.push(`KI ${url}: ${fehlerObjekt.message}`)
      }
    }
    funde ??= preiseAus(text)
    if (funde.length) seiten.push(url)
    preise.push(...funde.map((eintrag) => ({ ...eintrag, quelle: url })))
  }

  let status
  if (preise.some((eintrag) => KATEGORIEN.includes(eintrag.kategorie))) status = 'ok'
  else if (preise.length) status = 'nur sonstige Preise gefunden'
  else status = 'keine Preise gefunden'
  if (fehler.length) status += ` (${fehler.length} Fehler beim Abruf oder bei der KI-Auswertung)`

  return { name: kino.name, quelle: kino.url, geprueft, status, seiten, preise }
}

function heuteInZuerich() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function chf(betrag) {
  return `CHF ${betrag.toFixed(2)}`
}

function zelle(text) {
  return String(text).replace(/\|/g, '\\|')
}

export function vergleich(kinos, geprueft) {
  const zeilen = [`## Kinopreise Zürich, Stand ${geprueft}`, '']
  zeilen.push('| Kino | Normal | Ermässigt | Jugend | Aktion | Status |')
  zeilen.push('|---|---|---|---|---|---|')
  for (const kino of kinos) {
    const spalten = KATEGORIEN.map((name) => {
      const werte = kino.preise.filter((eintrag) => eintrag.kategorie === name).map((eintrag) => eintrag.preis)
      return werte.length ? chf(Math.min(...werte)) : '–'
    })
    zeilen.push(`| ${zelle(kino.name)} | ${spalten.join(' | ')} | ${zelle(kino.status)} |`)
  }
  zeilen.push('', 'Günstigster Preis je Kategorie. Alle gefundenen Zeilen stehen in scripts/kino-zuerich.json.', '')
  for (const kino of kinos.filter((k) => k.preise.length)) {
    zeilen.push('<details>', `<summary>${zelle(kino.name)}: ${kino.preise.length} Zeilen</summary>`, '')
    zeilen.push('| Kategorie | Bezeichnung | Preis |', '|---|---|---|')
    for (const eintrag of kino.preise) zeilen.push(`| ${eintrag.kategorie} | ${zelle(eintrag.bezeichnung)} | ${chf(eintrag.preis)} |`)
    zeilen.push('', '</details>', '')
  }
  return zeilen.join('\n')
}

async function main() {
  const ausgabe = process.argv[2] ?? join(hier, 'kino-zuerich.json')
  const geprueft = heuteInZuerich()

  const kinos = []
  for (const kino of KINOS) kinos.push(await pruefen(kino, geprueft))

  writeFileSync(ausgabe, JSON.stringify({ checkedOn: geprueft, ki: { budgetUsd: KI_BUDGET_USD, ausgegebenUsd: Number(kiAusgegeben.toFixed(4)) }, cinemas: kinos }, null, 2) + '\n')
  console.log(vergleich(kinos, geprueft))
  if (KI_BUDGET_USD > 0) console.log(`\nKI-Budget: ${kiAusgegeben.toFixed(3)} USD von ${KI_BUDGET_USD.toFixed(2)} USD verbraucht, ${TIEF ? 'tiefer' : 'normaler'} Scan.`)

  const mitPreisen = kinos.filter((kino) => kino.preise.some((eintrag) => KATEGORIEN.includes(eintrag.kategorie)))
  if (mitPreisen.length === 0) {
    console.error('::error::Kein Kino hat Preise geliefert, Quellen prüfen')
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
