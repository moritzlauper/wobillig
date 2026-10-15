# wogünstig 🍻 ☕

Eine einfache Zürich-Karte für Bier- und Kaffeepreise. TypeScript, Leaflet, Python-Scraper und eine Vercel-API für gemeinsam gespeicherte Preise. Keine Registrierung erforderlich.

## Was drin ist

- Umschalter **Bier / Kaffee**, mit direkt verlinkbarer Kaffeeansicht unter `?drink=coffee`.
- Kaffee nach Sorte vergleichen: Café crème/Kaffee, Espresso, doppelter Espresso, Ristretto, Cappuccino, Latte macchiato, Milchkaffee/Caffè latte, Flat White, Americano und Filterkaffee. Preise gelten **pro Getränk**, ohne erfundene Tassengrössen oder 5-dl-Umrechnung.
- Interaktive Karte und synchronisierte Liste mit echten OpenStreetMap-Standorten.
- Suche nach Bar, Strasse und Postleitzahl; Filter für Preis, Portionsgrösse, Bar/Pub/Biergarten/Restaurant/Café, Terrasse und alkoholfreies Bier.
- Grössenfilter **Stange / 3 dl** und **5 dl**. Die Stangen-Auswahl zeigt den tatsächlichen Glaspreis und ist unter `?size=stange` direkt verlinkbar. Sie enthält 3-dl-Angebote sowie ausdrücklich als Stange bezeichnete 3–3.3-dl-Portionen oder Angebote ohne Mengenangabe. Bekannte 2-dl-Portionen sowie alle als Flaschen- oder Dosenbier gekennzeichneten Angebote gehören nicht dazu, auch bei 3 dl.
- Startansicht mit **tatsächlich angebotenen 5-dl-Portionen**. Über „Genau 3 dl“ lässt sich die Stangen-Suche zusätzlich auf belegte 3 dl beschränken.
- Standardvergleich nach **tatsächlichem Glaspreis**, optional auf 5 dl umgerechnet. Ein kleineres Glas wird damit nicht automatisch zum besseren Deal. Die Stangen-Direktwahl und der 3-dl-Filter wechseln automatisch zum Glaspreis. Stangen ohne Mengenangabe zeigen „Grösse nicht angegeben“ und werden aus dem rechnerischen 5-dl-Vergleich ausgeschlossen.
- Sortierung nach Preis, Name oder Entfernung nach freiwilliger Standortfreigabe. Der Standort bleibt im Browser.
- **Offenbier / Flaschenbier / Dosenbier / Ausschankart unbekannt** in der Liste und in den Preisdetails. Die Kartenmarker zeigen nur den Preis. Ausschank-Filter und Auswahl beim Eintragen oder Korrigieren eines Bierpreises.
- Quellenlink, Portionsgrösse und Abrufdatum für jedes gefundene Angebot.
- Bars ohne passenden Preis bleiben optional auf der Karte sichtbar.
- Mobile Karten-/Listenansicht, Tastaturbedienung und Datenabdeckung.
- **Preis eintragen**, **Preis hinzufügen** und **Ändern**: Bier und Kaffee bei bekannten Lokalen ergänzen oder korrigieren. Alle Besucher sehen die gespeicherten Preise. Änderungen werden getrennt vom Scraper gespeichert und als ungeprüfte Einträge gekennzeichnet.
- Wöchentlicher Scraping-Workflow, CI und optionaler GitHub-Pages-Workflow.

## Ehrlicher Datenstand

Der Datenstand vom **15. Oktober 2026** enthält **427 Locations** in der administrativen Stadt Zürich, **1’006 Bierangebote bei 169 Locations** und **108 Locations mit alkoholhaltigen 5-dl-Angeboten**. Vor der jüngsten Erweiterung waren es 878 Angebote bei 149 Locations und 95 Locations mit 5 dl. Die Nachsuche hat 1’536 Restaurants/Cafés aus OSM betrachtet, 942 Websites direkt abgerufen und die archivierten Originaldokumente für 1’022 Kandidaten erneut ausgewertet. 23 Lokale haben erstmals Bierpreise; drei bisherige Zuordnungen zu fremden Filialkarten wurden entfernt. Neue Restaurants/Cafés werden nur mit gefundenen Preisen veröffentlicht. Dies sind Quellendaten, keine Demo-Preise. Die Zahlen ändern sich bei späteren Läufen.

Beispiele für echte 5-dl-Portionen aus den Originalkarten: Rheinfelder Bierhalle CHF 6.80, New Bombay (Erdinger) CHF 6.90, Amara CHF 6.80, Zum Guten Glück (Adler Lager) CHF 6.80 und La Stazione in Oerlikon CHF 5.50. Im El Lokal erkennt der Parser jetzt auch das Appenzeller vom Fass für CHF 8.50. Die Quellen sind direkt beim jeweiligen Angebot verlinkt.

„Möglichst jede Bar“ umfasst alle benannten OSM-Objekte mit `amenity=bar`, `pub` oder `biergarten` innerhalb der Stadtgrenze. Ergänzend werden ausgewählte Bierhallen, Restaurants und Cafés aus `scraper/additional_venues.json` bei jedem OSM-Import berücksichtigt. Koordinaten und Typ kommen weiterhin aus OSM; optional ergänzte Websites sind in dieser Datei erkennbar. Die zusätzliche Suche in `scraper/enrich.py` prüft systematisch Restaurants und Cafés mit eigener Website innerhalb derselben Stadtgrenze. Gemeinsame Websites mehrerer Standorte werden ohne expliziten Menühinweis ausgelassen. Nachtclubs werden nicht flächendeckend erfasst. OSM ist unvollständig; ein Standort kann veraltet oder falsch klassifiziert sein. Preise sind nur für einen Teil öffentlich maschinenlesbar. **Vollständigkeit und aktuelle Ausschankpreise sind nicht garantiert.**

Der Scraper folgt auch eingebetteten PDFs, PDF-Inhaltsverzeichnissen und verlinkten Lunchgate-Menüs. Er priorisiert Getränkekarten vor anderen Dokumenten. Der PDF-Parser trennt klare Spalten, liest Grössenüberschriften und ordnet Preise anhand der Textpositionen zu. Explizite Portionsgrössen direkt beim Produkt haben Vorrang. Einheiten, parallele Grössen-/Preislisten, umgebrochene Bierzeilen und Alkoholangaben werden ebenfalls ausgewertet. Auch Preis-vor-Menge-Zeilen und Einheiten mit Schluss-Punkt werden erkannt. Ein Flaschenabschnitt beendet die vorherige Fassbier-Mengenzuordnung; fehlende Flaschengrössen werden nicht übernommen.

Grafische oder mehrdeutige Originalkarten sind zusätzlich in `scraper/reviewed_menus.json` visuell geprüft hinterlegt. Diese Angebote erscheinen als **manuell geprüft** und werden nur bei identischer SHA-256-Prüfsumme der erneut abgerufenen Quelle übernommen. Bei als exklusiv markierten Prüfungen ersetzen diese Einträge die automatische Erkennung für dieselbe Karte. Eine geänderte Datei verlangt eine erneute Prüfung; alte geprüfte Preise daraus werden nicht blind übernommen. `source_scopes.json` verhindert bei bekannten gemeinsamen Websites, dass Karten anderer Filialen oder archivierte Menüs zugeordnet werden.

Mehrdeutige Tabellen, nicht geprüfte Bilder, reine JavaScript-Menüs, fehlende Grössen (ausser ausdrücklich als Stange bepreiste Portionen), Ginger Beer, Mineralwasser gleicher Marken, Catering-Karten, erkannte Liefer-/Bestellseiten, Take-away-Abschnitte und bedingte Angebote werden ausgelassen. 5 dl umfasst Fass-, Flaschen- und gegebenenfalls Dosenbier. Der Ausschank-Filter trennt diese Angebote. Belegte Ausschankarten stammen aus ausdrücklichen Angaben beim Getränk oder einer eindeutig zugeordneten Menüüberschrift. Fehlen solche Angaben, wird die Art separat anhand von Bezeichnung, Grössenvarianten und typischen Gebinden geschätzt. Die Oberfläche zeigt dann «geschätzt» und eine Begründung; der Ausschank-Filter berücksichtigt diese Vermutung. Eine Schätzung überschreibt niemals das ursprüngliche Quellenfeld. Am 15. Oktober 2026 sind 236 Angebote als Offenbier, 189 als Flaschenbier und 4 als Dosenbier belegt; bei 577 fehlt eine eindeutige Angabe. Diese bekommen nach Möglichkeit eine separate Schätzung; nur Angebote ohne plausible Zuordnung bleiben im Filter „Ausschankart unbekannt“. Automatisch erkannte Preise sind als solche markiert. Das Abrufdatum sagt, wann die Quelle gelesen wurde; eine alte PDF kann weiterhin online stehen. Alkoholfrei umfasst entsprechend bezeichnete Produkte und explizite Alkoholangaben bis 0.5 %, nicht ausschliesslich 0.0 %. Die Oberfläche trennt Gesamtangebote von den Locations mit einem zu den aktuellen Filtern passenden Preis.

### Stangenpreise

Die Stangen-Auswahl umfasst **174 Angebote**; **83 Locations** haben einen passenden alkoholhaltigen Preis. Die gezielte Nachsuche ergänzt 17 Angebote aus Originalkarten, etwa bei Gabbiano, Hot Pasta und Tramblu (je 3 dl für CHF 4.80), Handelshof (3 dl für CHF 5.50) und La Stazione (Stange für CHF 4.50, Menge nicht angegeben). Die Abrufdaten der wiederverwendeten Originaldokumente bleiben erhalten. Der reguläre Scraper erkennt diese Formate bei künftigen Läufen ebenfalls.

### Kaffee

`public/data/coffee.json` enthält am **15. Oktober 2026** **704 Kaffeeangebote bei 160 Locations** (zuvor 431 bei 105). **115 Locations** haben einen Preis für Café crème/Kaffee (zuvor 74). Die Erweiterung durchsucht aktuelle Originalseiten direkt und wertet vorhandene Dokumente erneut aus. Die Anzahl bezieht sich auf alle Sorten; der aktuelle Sortenfilter zeigt die dazu passenden Preise. Der Kaffee-Scraper prüft neben Bars auch Restaurants und Cafés innerhalb der Zürcher Stadtgrenze. Er übernimmt nur vollständig erkannte Kaffeenamen mit eindeutigem Preis (CHF 2–12). Einfache und doppelte Espressi bleiben getrennt; Caffè latte wird als Milchkaffee klassifiziert. Allgemein als „Kaffee“ bezeichnete Angebote sind mit Café crème gruppiert; der Originalname bleibt sichtbar. Eisgetränke, alkoholische Kaffees, Aufpreise und Kombiangebote werden nicht als Standardkaffee aufgenommen. Fehlende Sorten können als „Preis offen“ angezeigt werden. Die Kaffeeansicht veröffentlicht nur Locations mit gefundenen Kaffeepreisen.

Der Parser liest HTML und PDF-Text mit Positionen, erkennt CHF-/Fr.-Schreibweisen, hochgestellte Rappen, getrennte HTML-Preisspalten mit übereinstimmender Zeilenzahl, eingebettete Stadttabellen, gemeinsame Preise und eindeutige parallele Alternativen (`Espresso / Doppio 4.70 / 5.70`). Er schützt vor Seitenzahlen als Preisen, trennt bekannte Filialkarten über `coffee_source_scopes.json` und lässt Wochen-/Mittagsmenüs aus. Geprüfte Bildkarten und komplexe Layouts stehen in `reviewed_coffee_menus.json` mit SHA-256-Prüfsumme. Der optionale Claude-Scan ergänzt PDF- und Menübilder; nicht zugängliche JavaScript-Karten und unklare Zuordnungen benötigen weiterhin gesonderte Erfassung; die Karte beansprucht keine vollständige Abdeckung.

## Lokal starten

Voraussetzung: Node.js 22.12+ und Python 3.12+.

```sh
npm ci
npm run dev
```

Die App läuft unter `http://127.0.0.1:5173`. Der eingecheckte Datenbestand funktioniert ohne laufenden Scraper. Kartenkacheln brauchen eine Internetverbindung. Die Oberfläche verwendet Systemschriften. Gemeinsame Einträge benötigen die Vercel-API; ohne sie bleibt der statische Datenbestand nutzbar, das Speichern ist deaktiviert.

```sh
npm test
npm run build
npm run preview
```

`dist/` enthält das statische Frontend. Die vollständige App benötigt zusätzlich `api/prices.ts`. Für einen Unterpfad: `npm run build -- --base=/woguenstig/`.

## Scraper starten

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r scraper/requirements.txt
python -m unittest discover -s tests -p 'test_*.py'

# Standorte neu aus OSM laden und alle verlinkten Menüs prüfen
python -m scraper.scrape --discover

# Nur Standortimport
python -m scraper.scrape --discover --discover-only

# Zusätzliche Restaurants/Cafés suchen; älteste Prüfungen zuerst
python -m scraper.enrich --limit 200
# Vollständige Suche / erneute Prüfung fehlgeschlagener Kandidaten
python -m scraper.enrich --limit 0
python -m scraper.enrich --retry-failed --limit 200

# Kaffee: bekannte Locations aktualisieren und bis zu 200 neue Kandidaten prüfen
python -m scraper.scrape_coffee --discover --limit 200
# Alle zusätzlichen Kaffee-Kandidaten prüfen
python -m scraper.scrape_coffee --discover --limit 0

# Bestehende Standorte, begrenzter Durchlauf / einzelne Bar
python -m scraper.scrape --limit 20 --workers 4
python -m scraper.scrape --name 'Bar Rossi'
```

`--max-pages 8` (Standard) begrenzt die Dokumente pro Bar, `--workers` die Parallelität (maximal 8). Begrenzte Läufe beginnen mit den am längsten nicht geprüften Bars. `OVERPASS_URL` überschreibt den primären Overpass-Endpunkt. Standard ist `overpass.osm.ch`, Fallback `overpass-api.de`. `--osm-file /path/response.json` importiert eine gespeicherte vollständige Overpass-Antwort.

Beim Kaffee ergänzt `scraper/coffee_menu_urls.json` die allgemeinen Menühinweise. `scraper/coffee_checks.json` sorgt für rotierende Kandidaten. `--archive-dir /pfad/archiv` kann wiederholt angegeben werden, um zuvor mit dem Crawler abgerufene Dokumente offline neu auszuwerten; die ursprünglichen Abrufdaten bleiben erhalten. Der veröffentlichte Erstbestand nutzt auch diese Originaldokumente.

### Ablauf und Rücksichtnahme

1. OSM-Stadtgrenze und Standorte per Overpass abfragen; doppelte Node-/Way-Einträge desselben Namens in unmittelbarer Nähe zusammenführen.
2. Hinterlegte Website und zusätzliche Original-Menülinks aus `scraper/menu_urls.json` verwenden.
3. `robots.txt` lesen und respektieren. Bei Fehlern oder unklarer Erlaubnis wird die Website ausgelassen. Crawl-Delay und Request-Rate werden berücksichtigt, mindestens eine Sekunde Pause pro Host. Keine Login-, CAPTCHA- oder Zugriffsschutz-Umgehung.
4. Begrenzt HTML-Menüseiten, eingebettete PDFs und in PDFs verlinkte Unterkarten lesen. Externe Navigation nur für direkt verlinkte PDF-Dateien und den ausdrücklich verlinkten Menüanbieter `api2.lunchgate.ch`; jeder Redirect wird erneut geprüft. Private/Loopback-Adressen und ungewöhnliche Ports werden abgewiesen.
5. Nur Bierzeilen mit expliziter Grösse und zuordenbarem Preis übernehmen; bei ausdrücklich als Stange bepreisten Portionen darf die Grösse fehlen. Dann wird `volumeMl: null` mit `serving: "stange"` gespeichert, niemals eine Menge ergänzt. CHF 2–25 und 100–1000 ml sind Plausibilitätsgrenzen. Fehlende Preise werden nie geschätzt.
6. `public/data/bars.json` atomar schreiben. Ein fehlgeschlagener Abruf erhält den letzten bekannten Preis samt ursprünglichem Datum; erfolgreich gelesene, aber preislose Karten können alte Angebote entfernen. Bei teilweise fehlgeschlagenen Crawls können einzelne Angebote fehlen.

`scraper/discovery_checks.json` speichert den Prüfstand der zusätzlichen Kandidaten, damit begrenzte Läufe rotieren. Bereits aufgenommene Restaurants bleiben beim nächsten Standortimport erhalten. `website_overrides.json` ergänzt geprüfte offizielle Websites, wenn OSM keine oder eine veraltete URL enthält. `--audit-dir /tmp/beer-audit --review-only` archiviert die abgerufenen Originaldokumente und speichert neue Treffer zur Prüfung, ohne die veröffentlichte Karte zu verändern.

Weitere Menülinks ergänzen:

```json
{
  "node/5803645580": ["https://www.bar-rossi.ch/menue/"]
}
```

Der Schlüssel ist die bestehende OSM-ID. Preise oder Koordinaten müssen dafür nicht manuell erfunden werden. Fehlende Locations und Websites können direkt in OpenStreetMap ergänzt werden; der nächste Import übernimmt sie.

## GitHub Actions

- **Checks:** Frontend-Tests, TypeScript/Produktionsbuild und Python-Tests bei Push und Pull Request.
- **Refresh Zurich drink prices:** montags um 04:23 UTC und manuell unter Actions. Aktualisiert Standorte und bekannte Preise, prüft danach alle eindeutig zuordenbaren Gastronomie-Websites für Bier und Kaffee mit bis zu zehn Dokumenten pro Kandidat. Kaffee und zusätzliche Bier-Locations verwenden maximal acht parallele Abrufe; robots.txt, Pausen und Grössenlimits gelten weiterhin. Der Lauf committet beide Datenbestände samt Prüfstand und hat ein Limit von 120 Minuten. Benötigt die im Workflow deklarierte Schreibberechtigung für Repository-Inhalte. Private Repositories verwenden das Actions-Kontingent des Accounts.
- **Deploy to GitHub Pages (manual):** optional. Zuerst unter Settings → Pages die Quelle „GitHub Actions“ aktivieren, dann den Workflow starten. Für Pages aus privaten Repositories ist ein passender GitHub-Tarif erforderlich; das Repository wird nicht automatisch öffentlich gemacht. Nach Datenupdates muss dieser manuelle Deployment-Workflow erneut gestartet werden.

## Aufbau

```text
src/main.ts                  Oberfläche, Karte und Interaktionen
src/data.ts                  Filter, Preisnormalisierung, sichere Links
src/style.css                Responsive Gestaltung
public/data/bars.json        Versionierte Bierpreise
public/data/coffee.json      Versionierte Kaffeepreise
scraper/coffee.py            Erkennung von Kaffeesorten und Einzelpreisen
scraper/scrape_coffee.py     Kaffee-Import und optionale Offline-Auswertung
scraper/scrape.py            Standortimport, höflicher Crawler, PDF/HTML
scraper/extract.py           Konservative Preisextraktion
scraper/beer_type.py         Ausschankart aus ausdrücklichen Quellenangaben
scraper/pdf_extract.py       PDF-Spalten, Grössenüberschriften und Textpositionen
scraper/reviewed_menus.json   Geprüfte Bierkarten mit Inhalts-Prüfsummen
scraper/reviewed_coffee_menus.json Geprüfte Kaffeekarten mit Inhalts-Prüfsummen
scraper/source_scopes.json   Abgrenzung von Filial- und Archivkarten
scraper/menu_urls.json       Zusätzliche Original-Menülinks pro OSM-ID
scraper/additional_venues.json Ausgewählte weitere OSM-Locations und Websites
tests/                      Preis-, Filter- und Parser-Regressionstests
.github/workflows/          CI, Wochenimport, optionales Deployment
```

## Quellen und Nutzung

Standorte: [© OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Die OSM-abgeleiteten Standortdaten bleiben unter dieser Datenbanklizenz. Basiskarte: [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Getränkepreise stammen aus den im Datensatz verlinkten Originalkarten. Gespeichert werden strukturierte Preisfakten und kurze Belegzeilen, keine vollständigen Speisekarten. Es werden keine externen Schriften geladen.

Vor öffentlichem Betrieb die Nutzungsbedingungen und Kapazitätsgrenzen der Kartenanbieter sowie die Anforderungen der eigenen Bereitstellung prüfen. Der Code steht unter MIT; Rechte an den Quelldaten und fremden Inhalten bleiben separat.

## Vercel

Deployment mit der Vercel CLI:

```sh
vercel link --project woguenstig
vercel --prod
```

`vercel.json` konfiguriert den Vite-Build. Der Scraper läuft weiterhin in GitHub Actions; Vercel liefert den eingecheckten Datenbestand statisch aus. Nach Datenupdates erneut deployen oder die GitHub-Integration in Vercel verbinden. `.vercelignore` hält die lokale Python-Umgebung und den Scraper aus dem Deployment-Upload.

## Gemeinsame Preise

Die API unter `/api/prices` liest und schreibt in einem privaten Vercel-Blob-Store. Ausschliesslich der Server erhält `BLOB_READ_WRITE_TOKEN`; es gibt keinen öffentlichen Upload-Token. Die veröffentlichte API gibt nur Preise zurück, keine internen Rate-Limit-Daten oder Historie.

- Produktion: `prices/production.json`; Entwicklung und Vorschau: `prices/development.json`.
- Korrekturen ersetzen das passende Angebot in der Anzeige, ohne die ursprünglichen JSON-Dateien zu verändern. Die Zuordnung hängt nicht am bisherigen Preis oder Quellenlink. Offen- und Flaschenbier mit demselben Namen und derselben Menge haben getrennte Einträge. Ältere Korrekturen ohne Ausschankart werden nur bei eindeutiger Zuordnung auf ein inzwischen klassifiziertes Angebot angewendet. Ein erneuter Scraper-Lauf überschreibt diese Korrekturen deshalb nicht.
- Validierung: bekanntes Lokal, gültige Sorte/Menge, CHF 0.50–50, echtes Datum bis heute und optionale HTTP(S)-Quelle. Keine Umrechnung beim Eintragen.
- Gleichzeitige Schreibvorgänge verwenden ETags; überholte Formularversionen erhalten HTTP 409 statt Änderungen zu überschreiben. Frühere Versionen bleiben intern in `history` erhalten.
- 20 Schreibvorgänge pro Stunde und Besucherkennung. Kennungen sind mit dem Speichergeheimnis und Tagesdatum abgeleitete IP-Hashes; keine IP-Adressen im gespeicherten JSON. Abgelaufene Kennungen werden beim nächsten Schreiben entfernt.
- Kein Login und keine Vorabmoderation. Öffentliche Einträge sind als „Eingetragen · nicht geprüft“ sichtbar.

Lokale Entwicklung mit API:

```sh
vercel env pull .env.local
vercel dev
```

Speicher für eine neue Installation verbinden:

```sh
vercel blob create-store woguenstig-prices --access private --region fra1 --yes
vercel deploy --prod --yes
```

`.env.local` bleibt ignoriert. GitHub Pages kann nur den statischen Datenbestand darstellen; für öffentlich gespeicherte Einträge ist das Vercel-Deployment erforderlich.

`npm run test:storage` prüft den verbundenen Blob-Store mit temporären, anschliessend gelöschten Testobjekten. Dazu muss `.env.local` vorhanden sein. Der Test prüft aufeinanderfolgende und gleichzeitige Schreibvorgänge inklusive Versionskonflikten und wachsender Historie. Im normalen Testlauf wird dieser Integrationstest übersprungen.

## Claude-Scans in GitHub Actions

Das Repository-Secret `ANTHROPIC_API_KEY` wird ausschliesslich dem KI-Scan-Schritt übergeben. Es gehört weder in den Browser noch in Vercel oder die Daten-Dateien. `Refresh Zurich drink prices` führt montags nach der normalen Suche den Claude-Scan aus; manuell sind `full`, `ai_only` und `estimates_only` auswählbar.

`python -m scraper.ai_scan --discover` sucht zusätzliche Zürcher Restaurants/Cafés, folgt Menülinks und liest HTML, PDF-Seiten samt Bildern sowie direkt verlinkte Menübilder. Derselbe Aufruf sammelt Bier und Kaffee. Claude Sonnet 4.6 liefert strukturierte Ergebnisse; Mengen, Preise, Quellenzuordnung und Preisbelege werden zusätzlich validiert. Bestehende widersprechende Preise werden nicht automatisch ersetzt. Neue KI-Preise tragen «KI-erkannt · nicht geprüft», Quellenlink, Abrufdatum, Dokument-Hash und gegebenenfalls PDF-Seite. KI-Erkennung kann dennoch fehlerhaft sein.

Unbekannte Ausschankarten erhalten `beerTypeEstimate` (Typ, Begründung, Methode), während `beerType` unverändert bleibt. Preise und Mengen werden nicht geschätzt. Die normale Suche verwendet ergänzend nachvollziehbare Regeln; KI-Schätzungen bleiben beim Regel-Durchlauf erhalten, ausser eindeutige Portionsbezeichnungen oder mehrere passende Glasgrössen widersprechen ihnen. Besucherkorrekturen haben Vorrang, ihre Angebotsschlüssel hängen nicht an einer Schätzung.

Standardgrenzen pro Lauf: 20 USD geschätzte API-Kosten, 300 Generierungen, 8 Dokumente pro Lokal, 60 Minuten KI-Menüsuche im Workflow. Vor jeder Generierung werden Eingabetokens gezählt und die maximalen Ausgabekosten reserviert; fehlgeschlagene Requests behalten ihre Reservierung. Preisbasis: [Anthropic-Preise](https://platform.claude.com/docs/en/about-claude/pricing), Sonnet 4.6 mit 3 USD / Mio. Eingabe- und 15 USD / Mio. Ausgabetokens, ohne Steuern. Grenzen sind manuell bis 100 USD / 1000 Requests konfigurierbar. Öffentliche Quellen und Extrakte werden an Anthropic gesendet; keine Besucher- oder Community-Daten. Der Anbieter-Schlüssel wird nur an `api.anthropic.com` gesendet.

Ein Inhalts-Cache verhindert erneute API-Kosten für identische Dokumente/Prompts. `scraper/ai_checks.json` lässt spätere Läufe zu noch nicht geprüften Lokalen weitergehen. Ein Bericht mit Kosten, Treffern und Fehlern steht im Actions-Lauf und als Artefakt. Bei fehlendem Schlüssel bleibt der normale Scraper verwendbar; bei API-/Netzwerkfehlern werden vorhandene Angebote erhalten. Robots-Regeln und bestehende Filial-/Quellenbeschränkungen gelten weiterhin.
