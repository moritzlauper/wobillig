#!/usr/bin/env node
/**
 * Getränke-Vergleich Zürich: Preis pro 100 ml über alle erfassten Läden.
 *
 * Läden füllen unterschiedlich grosse Gläser ab, darum wird immer der Preis
 * pro 100 ml verglichen. Pro Laden und Kategorie zählt das günstigste Getränk.
 * Preise, die älter als MAX_AGE_DAYS sind, bleiben in der Ausgabe, fliessen
 * aber nicht in die Rangliste ein.
 *
 * Eingabe (getraenke/zuerich.json):
 *   {
 *     "shops": [
 *       {
 *         "name": "Laden",
 *         "address": "Strasse 1, 8001 Zürich",
 *         "source": "https://...",
 *         "checkedOn": "2026-10-28",
 *         "drinks": [
 *           { "category": "bier", "name": "Bier vom Fass", "ml": 500, "price": 7.5 }
 *         ]
 *       }
 *     ]
 *   }
 *
 *   node scripts/getraenke-zuerich.mjs getraenke/zuerich.json
 *
 * Die Ausgabe ist Markdown für die GitHub-Actions-Zusammenfassung. Jede Kategorie
 * ist ein aufklappbarer Block, alle Getränke je Laden stehen in einem weiteren.
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

function datum(iso) {
  return iso.split("-").reverse().join(".")
}

function zelle(text) {
  return String(text).replace(/\|/g, "\\|")
}

function alterInTagen(iso, now) {
  return Math.floor((now - Date.parse(`${iso}T00:00:00Z`)) / 86400000)
}

function titel(kategorie) {
  return kategorie.charAt(0).toUpperCase() + kategorie.slice(1)
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
  if (!Array.isArray(shop.drinks) || shop.drinks.length === 0) {
    fail(`${label}: mindestens ein Getränk angeben.`)
  }
  for (const drink of shop.drinks) {
    if (typeof drink.category !== "string" || !drink.category.trim()) {
      fail(`${label}: category fehlt bei "${drink.name ?? "?"}".`)
    }
    if (typeof drink.name !== "string" || !drink.name.trim()) {
      fail(`${label}: name fehlt bei Kategorie "${drink.category}".`)
    }
    if (!Number.isInteger(drink.ml) || drink.ml < 1) {
      fail(`${label}: ml muss eine ganze Zahl ab 1 sein.`)
    }
    if (typeof drink.price !== "number" || drink.price <= 0) {
      fail(`${label}: price muss eine Zahl über 0 sein.`)
    }
  }
}

// ─── Vergleich ───────────────────────────────────────────────────────────────

const file = process.argv[2]
if (!file) fail("Aufruf: node scripts/getraenke-zuerich.mjs getraenke/zuerich.json")

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
  const drinks = shop.drinks.map((drink) => ({
    ...drink,
    kategorie: drink.category.trim().toLowerCase(),
    per100: (drink.price / drink.ml) * 100,
  }))
  const best = new Map()
  for (const drink of drinks) {
    const vorhanden = best.get(drink.kategorie)
    if (!vorhanden || drink.per100 < vorhanden.per100) best.set(drink.kategorie, drink)
  }
  return { shop, drinks, best, age: alterInTagen(shop.checkedOn, now) }
})

const byName = (a, b) => a.shop.name.localeCompare(b.shop.name, "de-CH")
const fresh = entries.filter((entry) => entry.age <= MAX_AGE_DAYS).sort(byName)
const stale = entries.filter((entry) => entry.age > MAX_AGE_DAYS).sort(byName)
const kategorien = [...new Set(fresh.flatMap((entry) => [...entry.best.keys()]))].sort((a, b) =>
  a.localeCompare(b, "de-CH")
)

// ─── Ausgabe ─────────────────────────────────────────────────────────────────

const out = ["## Getränke Zürich: Preis pro 100 ml", ""]

if (shops.length === 0) {
  out.push("Noch keine Läden erfasst. Einträge stehen in `getraenke/zuerich.json`.", "")
} else {
  out.push(
    `Stand ${datum(today)}: ${fresh.length} Läden im Vergleich, ${stale.length} mit veralteten Preisen.`,
    ""
  )

  if (fresh.length === 0) {
    out.push(`Keine Läden mit Preisen jünger als ${MAX_AGE_DAYS} Tage.`, "")
  }

  for (const kategorie of kategorien) {
    const rangliste = fresh
      .filter((entry) => entry.best.has(kategorie))
      .sort((a, b) => a.best.get(kategorie).per100 - b.best.get(kategorie).per100 || byName(a, b))

    out.push("<details>", `<summary>${titel(kategorie)}</summary>`, "")
    out.push(
      "| # | Laden | Pro 100 ml | Günstigstes Getränk | Menge | Preis | Geprüft |",
      "|---|---|---|---|---|---|---|"
    )
    rangliste.forEach(({ shop, best }, index) => {
      const drink = best.get(kategorie)
      out.push(
        `| ${index + 1} | ${zelle(shop.name)} | ${chf(drink.per100)} | ${zelle(drink.name)} | ${drink.ml} ml | ${chf(drink.price)} | ${datum(shop.checkedOn)} |`
      )
    })
    out.push("", "</details>", "")
  }

  if (fresh.length > 0) {
    out.push("<details>", "<summary>Alle Getränke je Laden</summary>", "")
    for (const { shop, drinks } of fresh) {
      out.push("<details>", `<summary>${shop.name}: alle Getränke</summary>`, "")
      if (shop.address) out.push(shop.address, "")
      if (shop.source) out.push(`[Quelle](${shop.source})`, "")
      out.push("| Kategorie | Getränk | Menge | Preis | Pro 100 ml |", "|---|---|---|---|---|")
      for (const drink of drinks) {
        out.push(
          `| ${zelle(titel(drink.kategorie))} | ${zelle(drink.name)} | ${drink.ml} ml | ${chf(drink.price)} | ${chf(drink.per100)} |`
        )
      }
      out.push("", "</details>", "")
    }
    out.push("</details>", "")
  }

  if (stale.length > 0) {
    out.push("<details>", `<summary>Veraltet, nicht im Vergleich (${stale.length})</summary>`, "")
    for (const { shop } of stale) {
      out.push(`- ${shop.name}, geprüft am ${datum(shop.checkedOn)}`)
    }
    out.push("", "</details>", "")
  }
}

process.stdout.write(`${out.join("\n")}\n`)
