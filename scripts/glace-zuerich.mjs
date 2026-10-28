#!/usr/bin/env node
/**
 * Glace-Vergleich Zürich: Preis pro Kugel über alle erfassten Läden.
 *
 * Läden verkaufen Portionen mit unterschiedlich vielen Kugeln, darum wird immer
 * der Preis pro Kugel verglichen. Pro Laden zählt die günstigste Portion.
 * Preise, die älter als MAX_AGE_DAYS sind, bleiben in der Ausgabe, fliessen
 * aber nicht in die Rangliste ein.
 *
 * Eingabe (glace/zuerich.json):
 *   {
 *     "shops": [
 *       {
 *         "name": "Laden",
 *         "address": "Strasse 1, 8001 Zürich",
 *         "source": "https://...",
 *         "checkedOn": "2026-10-28",
 *         "portions": [ { "scoops": 1, "price": 3.5 }, { "scoops": 3, "price": 8.5 } ]
 *       }
 *     ]
 *   }
 *
 *   node scripts/glace-zuerich.mjs glace/zuerich.json
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

function kugeln(count) {
  return count === 1 ? "1 Kugel" : `${count} Kugeln`
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
  if (!Array.isArray(shop.portions) || shop.portions.length === 0) {
    fail(`${label}: mindestens eine Portion angeben.`)
  }
  for (const portion of shop.portions) {
    if (!Number.isInteger(portion.scoops) || portion.scoops < 1) {
      fail(`${label}: scoops muss eine ganze Zahl ab 1 sein.`)
    }
    if (typeof portion.price !== "number" || portion.price <= 0) {
      fail(`${label}: price muss eine Zahl über 0 sein.`)
    }
  }
}

// ─── Vergleich ───────────────────────────────────────────────────────────────

const file = process.argv[2]
if (!file) fail("Aufruf: node scripts/glace-zuerich.mjs glace/zuerich.json")

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
    perScoop: portion.price / portion.scoops,
  }))
  const best = portions.reduce((a, b) => (b.perScoop < a.perScoop ? b : a))
  return { shop, portions, best, age: alterInTagen(shop.checkedOn, now) }
})

const byName = (a, b) => a.shop.name.localeCompare(b.shop.name, "de-CH")
const fresh = entries
  .filter((entry) => entry.age <= MAX_AGE_DAYS)
  .sort((a, b) => a.best.perScoop - b.best.perScoop || byName(a, b))
const stale = entries.filter((entry) => entry.age > MAX_AGE_DAYS).sort(byName)

// ─── Ausgabe ─────────────────────────────────────────────────────────────────

const out = ["## Glace Zürich: Preis pro Kugel", ""]

if (shops.length === 0) {
  out.push("Noch keine Läden erfasst. Einträge stehen in `glace/zuerich.json`.", "")
} else {
  out.push(
    `Stand ${datum(today)}: ${fresh.length} Läden im Vergleich, ${stale.length} mit veralteten Preisen.`,
    "",
    "<details>",
    "<summary>Vergleich pro Kugel</summary>",
    ""
  )

  if (fresh.length === 0) {
    out.push(`Keine Läden mit Preisen jünger als ${MAX_AGE_DAYS} Tage.`, "")
  } else {
    out.push(
      "| # | Laden | Pro Kugel | Günstigste Portion | Geprüft |",
      "|---|---|---|---|---|"
    )
    fresh.forEach((entry, index) => {
      const { best, shop } = entry
      out.push(
        `| ${index + 1} | ${zelle(shop.name)} | ${chf(best.perScoop)} | ${kugeln(best.scoops)} für ${chf(best.price)} | ${datum(shop.checkedOn)} |`
      )
    })
    out.push("")

    for (const { shop, portions } of fresh) {
      out.push("<details>", `<summary>${shop.name}: alle Portionen</summary>`, "")
      if (shop.address) out.push(shop.address, "")
      if (shop.source) out.push(`[Quelle](${shop.source})`, "")
      out.push("| Kugeln | Preis | Pro Kugel |", "|---|---|---|")
      for (const portion of portions) {
        out.push(`| ${portion.scoops} | ${chf(portion.price)} | ${chf(portion.perScoop)} |`)
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
