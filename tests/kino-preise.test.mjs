import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kategorie, kiFundePruefen, kiKosten, kiReserve, preiseAus, preisLinks, regelnAus, textOf } from '../scripts/kino-preise.mjs'

const hier = dirname(fileURLToPath(import.meta.url))
const seite = readFileSync(join(hier, 'fixtures', 'kino-filmpodium-tickets.html'), 'utf8')

test('robots.txt: nur die Gruppe * zählt, leere Disallow-Zeilen erlauben alles', () => {
  const text = 'User-agent: Googlebot\nDisallow: /geheim\n\nUser-agent: *\nDisallow: /tickets/\nDisallow:\nSitemap: https://example.ch/s.xml'
  assert.deepEqual(regelnAus(text), ['/tickets/'])
})

test('KI-Kosten: Sätze wie in scraper/ai.py, die Reserve deckt eine volle Seite ab', () => {
  assert.equal(kiKosten({ input_tokens: 100000, output_tokens: 1000 }), (100000 * 0.10 + 1000 * 0.50) / 1_000_000)
  assert.equal(kiKosten({ input_tokens: 200000, output_tokens: 1000 }), (200000 * 0.50 + 1000 * 2.50) / 1_000_000)
  // 30 000 Zeichen sind rund 10 000 Token Eingabe und 2 000 Token Ausgabe, also 0,01 USD.
  assert.ok(Math.abs(kiReserve('x'.repeat(30000)) - 0.01) < 1e-12)
  assert.ok(kiReserve('x'.repeat(30000)) >= kiKosten({ input_tokens: 10000, output_tokens: 2000 }))
})

test('Filmpodium: Eintrittspreise werden den Kategorien zugeordnet', () => {
  const preise = preiseAus(textOf(seite))
  const suche = (kat) => preise.filter((p) => p.kategorie === kat).map((p) => p.preis)
  assert.ok(suche('normal').includes(18), 'Regulärer Eintritt 18 fehlt')
  assert.ok(suche('ermaessigt').includes(15), 'AHV/Legi 15 fehlt')
  assert.ok(suche('aktion').includes(14), 'Kino-Montag 14 fehlt')
  assert.ok(suche('jugend').includes(9), 'Unter 25 / Kulturlegi 9 fehlt')
})

test('Filmpodium: Cent-Beträge und Gutscheine werden gelesen', () => {
  const preise = preiseAus(textOf(seite))
  assert.ok(preise.some((p) => p.preis === 20), 'Jahresabo 20.00 fehlt')
  assert.ok(preise.some((p) => p.preis === 80), 'Programm-Pass 80 fehlt')
})

test('Kategorien: Kulturlegi gilt als Jugend, nicht als Legi', () => {
  assert.equal(kategorie('Unter 25 Jahre & Kulturlegi'), 'jugend')
  assert.equal(kategorie('AHV und Legi'), 'ermaessigt')
  assert.equal(kategorie('Kino-Montag/Monday discount'), 'aktion')
  assert.equal(kategorie('Regulärer Eintrittspreis'), 'normal')
  assert.equal(kategorie('Jahresabo (7 Ausgaben)'), 'sonstige')
})

test('Preisseiten: Links auf derselben Website, Preisseiten zuerst, Ticketnummern ausgelassen', () => {
  const html = `
    <a href="/kontakt">Kontakt</a>
    <a href="https://fremd.ch/tickets">extern</a>
    <a href="/tickets/2283786">Vorstellung</a>
    <a href="/tickets-abo?dialog=false">Tickets</a>
    <a href="/preise">Preise</a>
    <a href="/agb.pdf">AGB</a>`
  assert.deepEqual(preisLinks(html, 'https://kino.example/'), [
    'https://kino.example/preise',
    'https://kino.example/tickets-abo?dialog=false',
  ])
})

test('KI: nur Preise mit wörtlich gefundenem Belegzitat werden übernommen', () => {
  const seite = 'Regulärer Eintritt: CHF 18.– AHV und Legi: CHF 15.–'
  const antwort = [
    { kategorie: 'normal', bezeichnung: 'Regulärer Eintritt', preis: 18, belegzitat: 'Regulärer Eintritt: CHF 18.-' },
    { kategorie: 'ermaessigt', bezeichnung: 'AHV', preis: 15, belegzitat: 'AHV und Legi: CHF 15.–' },
    { kategorie: 'normal', bezeichnung: 'Erfunden', preis: 30, belegzitat: 'steht nicht auf der Seite' },
    { kategorie: 'normal', bezeichnung: 'Ohne Preis', preis: 0, belegzitat: 'Regulärer Eintritt' },
    { kategorie: 'unbekannt', bezeichnung: 'Sonderfall', preis: 20, belegzitat: 'AHV und Legi' },
  ]
  const funde = kiFundePruefen(antwort, seite)
  assert.deepEqual(funde.map((f) => [f.kategorie, f.preis, f.methode]), [
    ['normal', 18, 'ki'],
    ['ermaessigt', 15, 'ki'],
    ['sonstige', 20, 'ki'],
  ])
})

test('Text: CHF-Zeilen stehen nach Blockgrenzen auf eigenen Zeilen', () => {
  const text = textOf('<p>Normal: CHF 17.&ndash;</p><p>Kind: CHF 10.-</p>')
  assert.deepEqual(preiseAus(text).map((p) => p.preis), [17, 10])
})
