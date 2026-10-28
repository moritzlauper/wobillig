#!/usr/bin/env node
/**
 * Sushi-Vergleich Zürich: Preis pro Stück über alle erfassten Läden.
 *
 * Läden verkaufen Sushi in Portionen mit unterschiedlich vielen Stücken (Box, Platte, Set),
 * darum wird immer der Preis pro Stück verglichen. Pro Laden zählt die günstigste Portion.
 * Preise, die älter als MAX_AGE_DAYS sind, bleiben in der Ausgabe, fliessen aber nicht in die
 * Rangliste ein.
 *
 * Verglichen werden nur Angebote mit fester Stückzahl. All-you-can-eat und Preise pro Person
 * gehören nicht in diese Datei, weil dort die Menge nicht festgelegt ist. Jeder Preis braucht
 * eine Quelle (https-Link auf die Speisekarte) und ein Prüfdatum.
 *
 * Eingabe (sushi/zuerich.json):
 *   {
 *     "shops": [
 *       {
 *         "name": "Laden",
 *         "address": "Strasse 1, 8001 Zürich",
 *         "source": "https://...",
 *         "checkedOn": "2026-10-28",
 *         "portions": [ { "pieces": 8, "price": 19.5 }, { "pieces": 16, "price": 36 } ]
 *       }
 *     ]
 *   }
 *
 *   node scripts/sushi-zuerich.mjs sushi/zuerich.json
 *
 * Die Ausgabe ist Markdown für die GitHub-Actions-Zusammenfassung. Der ganze
 * Vergleich steht in einem <details>-Block, die Portionen je Laden in weiteren.
 */

import { readFileSync } from "node:fs"

const MAX_AGE_DAYS = 180

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

function chf(value) {
  return `CHF ${value.toFixed(2)}`
}

function stueck(count) {
  return `${count} Stück`
}

function datum(iso) {
  return iso.split("-").reverse().join(".")
}

function zelle(text) {
  return String(text).replace(/\|/g, "\\|")
}

function alterInTagen(iso, now) {
  return Math.floor((now - Date.parse(`${iso}T00:00:00Z`)) / 86400000)
}

// ─── Validierung ─────────────────────────────────────────────────────────────

function pruefen(shop, index) {
  const label = shop.name || `Eintrag ${index + 1}`
  if (typeof shop.name !== "string" || !shop.name.trim()) {
    fail(`Eintrag ${index + 1}: name fehlt.`)
  }
  const checkedOn = shop.checkedOn ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn) || Number.isNaN(Date.parse(`${checkedOn}T00:00:00Z`))) {
    fail(`${label}: checkedOn im Format JJJJ-MM-TT angeben.`)
  }
  if (typeof shop.source !== "string" || !/^https:\/\//.test(shop.source)) {
    fail(`${label}: source muss ein https-Link auf die Speisekarte sein.`)
  }
  if (!Array.isArray(shop.portions) || shop.portions.length === 0) {
    fail(`${label}: mindestens eine Portion angeben.`)
  }
  for (const portion of shop.portions) {
    if (!Number.isInteger(portion.pieces) || portion.pieces < 1) {
      fail(`${label}: pieces muss eine ganze Zahl ab 1 sein.`)
    }
    if (typeof portion.price !== "number" || portion.price <= 0) {
      fail(`${label}: price muss eine Zahl über 0 sein.`)
    }
  }
}

// ─── Vergleich ───────────────────────────────────────────────────────────────

const file = process.argv[2]
if (!file) fail("Aufruf: node scripts/sushi-zuerich.mjs sushi/zuerich.json")

let shops
try {
  shops = JSON.parse(readFileSync(file, "utf8")).shops ?? []
} catch (error) {
  fail(`${file} lässt sich nicht lesen: ${error.message}`)
}

shops.forEach(pruefen)

const now = Date.now()
const today = new Date(now).toISOString().slice(0, 10)

const entries = shops.map((shop) => {
  const portions = shop.portions.map((portion) => ({
    ...portion,
    perPiece: portion.price / portion.pieces,
  }))
  const best = portions.reduce((a, b) => (b.perPiece < a.perPiece ? b : a))
  return { shop, portions, best, age: alterInTagen(shop.checkedOn, now) }
})

const byName = (a, b) => a.shop.name.localeCompare(b.shop.name, "de-CH")
const fresh = entries
  .filter((entry) => entry.age <= MAX_AGE_DAYS)
  .sort((a, b) => a.best.perPiece - b.best.perPiece || byName(a, b))
const stale = entries.filter((entry) => entry.age > MAX_AGE_DAYS).sort(byName)

// ─── Ausgabe ─────────────────────────────────────────────────────────────────

const out = ["## Sushi Zürich: Preis pro Stück", ""]

if (shops.length === 0) {
  out.push("Noch keine Läden erfasst. Einträge stehen in `sushi/zuerich.json`.", "")
} else {
  out.push(
    `Stand ${datum(today)}: ${fresh.length} Läden im Vergleich, ${stale.length} mit veralteten Preisen.`,
    "",
    "<details>",
    "<summary>Vergleich pro Stück</summary>",
    ""
  )

  if (fresh.length === 0) {
    out.push(`Keine Läden mit Preisen jünger als ${MAX_AGE_DAYS} Tage.`, "")
  } else {
    out.push(
      "| # | Laden | Pro Stück | Günstigste Portion | Geprüft |",
      "|---|---|---|---|---|"
    )
    fresh.forEach((entry, index) => {
      const { best, shop } = entry
      out.push(
        `| ${index + 1} | ${zelle(shop.name)} | ${chf(best.perPiece)} | ${stueck(best.pieces)} für ${chf(best.price)} | ${datum(shop.checkedOn)} |`
      )
    })
    out.push("")

    for (const { shop, portions } of fresh) {
      out.push("<details>", `<summary>${shop.name}: alle Portionen</summary>`, "")
      if (shop.address) out.push(shop.address, "")
      out.push(`[Quelle](${shop.source})`, "")
      out.push("| Stück | Preis | Pro Stück |", "|---|---|---|")
      for (const portion of portions) {
        out.push(`| ${portion.pieces} | ${chf(portion.price)} | ${chf(portion.perPiece)} |`)
      }
      out.push("", "</details>", "")
    }
  }

  if (stale.length > 0) {
    out.push("<details>", `<summary>Veraltet, nicht im Vergleich (${stale.length})</summary>`, "")
    for (const { shop } of stale) {
      out.push(`- ${shop.name}, geprüft am ${datum(shop.checkedOn)}`)
    }
    out.push("", "</details>", "")
  }

  out.push("</details>", "")
}

process.stdout.write(`${out.join("\n")}\n`)
