# wogünstig 🍻

**Gutes Bier. Guter Preis.** Eine schlichte, responsive Zürich-Karte für den nächsten Feierabend. TypeScript, Leaflet und ein Python-Scraper – ohne API-Key, Benutzerkonto oder eigenes Backend.

## Was drin ist

- Interaktive Karte und synchronisierte Liste mit echten OpenStreetMap-Standorten.
- Suche nach Bar, Strasse und Postleitzahl; Filter für Preis, Portionsgrösse, Bar/Pub/Biergarten/Restaurant/Café, Terrasse und alkoholfreies Bier.
- Startansicht mit **tatsächlich angebotenen 5-dl-Portionen**. Andere Grössen sind über den Filter verfügbar.
- Standardvergleich nach **rechnerischem Preis pro 5 dl**, optional nach Glaspreis. Ein kleineres Glas wird damit nicht automatisch zum besseren Deal.
- Sortierung nach Preis, Name oder Entfernung nach freiwilliger Standortfreigabe. Der Standort bleibt im Browser.
- Quellenlink, Portionsgrösse und Abrufdatum für jedes gefundene Angebot.
- Bars ohne passenden Preis bleiben optional auf der Karte sichtbar.
- Mobile Karten-/Listenansicht, Tastaturbedienung und transparente Datenabdeckung.
- Wöchentlicher Scraping-Workflow, CI und optionaler GitHub-Pages-Workflow.

## Ehrlicher Datenstand

Der Datenstand vom **15. Oktober 2026** enthält **302 Locations** in der administrativen Stadt Zürich. Nach Erweiterung des Scrapers gibt es **355 Preisangebote bei 43 Locations** (zuvor 144 bei 25). Bei 34 Locations ist mindestens ein alkoholhaltiges 5-dl-Angebot erfasst. Dies sind Quellendaten, keine Demo-Preise. Die Zahlen ändern sich bei späteren Läufen.

Beispiele für echte 5-dl-Portionen aus den Originalkarten: Rheinfelder Bierhalle CHF 6.80, New Bombay (Erdinger) CHF 6.90, Amara CHF 6.80, Zum Guten Glück (Adler Lager) CHF 6.80 und La Stazione in Oerlikon CHF 5.50. Im El Lokal erkennt der Parser jetzt auch das Appenzeller vom Fass für CHF 8.50. Die Quellen sind direkt beim jeweiligen Angebot verlinkt.

„Möglichst jede Bar“ umfasst alle benannten OSM-Objekte mit `amenity=bar`, `pub` oder `biergarten` innerhalb der Stadtgrenze. Ergänzend werden ausgewählte Bierhallen, Restaurants und Cafés aus `scraper/additional_venues.json` bei jedem OSM-Import berücksichtigt. Koordinaten und Typ kommen weiterhin aus OSM; optional ergänzte Websites sind in dieser Datei erkennbar. Andere Restaurants, Cafés und Nachtclubs werden nicht flächendeckend erfasst. OSM ist unvollständig; ein Standort kann veraltet oder falsch klassifiziert sein. Preise sind nur für einen Teil öffentlich maschinenlesbar. **Vollständigkeit und aktuelle Ausschankpreise sind nicht garantiert.**

Der Scraper folgt auch eingebetteten PDFs, PDF-Inhaltsverzeichnissen und verlinkten Lunchgate-Menüs. Er priorisiert Getränkekarten vor anderen Dokumenten. Der PDF-Parser trennt klare Spalten, liest Grössenüberschriften und ordnet Preise anhand der Textpositionen zu. Explizite Portionsgrössen direkt beim Produkt haben Vorrang. Einheiten, parallele Grössen-/Preislisten, umgebrochene Bierzeilen und Alkoholangaben werden ebenfalls ausgewertet.

Zwei grafische Originalkarten sind zusätzlich in `scraper/reviewed_menus.json` visuell geprüft hinterlegt. Diese Angebote erscheinen als **manuell geprüft** und werden nur bei identischer SHA-256-Prüfsumme der erneut abgerufenen Quelle übernommen. Eine geänderte Datei verlangt eine erneute Prüfung; alte geprüfte Preise daraus werden nicht blind übernommen. `source_scopes.json` verhindert bei bekannten gemeinsamen Websites, dass Karten anderer Filialen oder archivierte Menüs zugeordnet werden.

Mehrdeutige Tabellen, nicht geprüfte Bilder, reine JavaScript-Menüs, fehlende Grössen, Ginger Beer, Catering-Karten und bedingte Angebote werden ausgelassen. Automatisch erkannte Preise sind als solche markiert. Das Abrufdatum sagt, wann die Quelle gelesen wurde; eine alte PDF kann weiterhin online stehen. Alkoholfrei umfasst entsprechend bezeichnete Produkte und explizite Alkoholangaben bis 0.5 %, nicht ausschliesslich 0.0 %. Die Oberfläche trennt Gesamtangebote von den Locations mit einem zu den aktuellen Filtern passenden Preis.

## Lokal starten

Voraussetzung: Node.js 22.12+ und Python 3.12+.

```sh
npm ci
npm run dev
```

Die App läuft unter `http://127.0.0.1:5173`. Der eingecheckte Datenbestand funktioniert ohne laufenden Scraper. Kartenkacheln und Schriftarten brauchen eine Internetverbindung.

```sh
npm test
npm run build
npm run preview
```

`dist/` ist eine statische Website. Für einen Unterpfad: `npm run build -- --base=/woguenstig/`.

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

# Bestehende Standorte, begrenzter Durchlauf / einzelne Bar
python -m scraper.scrape --limit 20 --workers 4
python -m scraper.scrape --name 'Bar Rossi'
```

`--max-pages 8` (Standard) begrenzt die Dokumente pro Bar, `--workers` die Parallelität (maximal 8). Begrenzte Läufe beginnen mit den am längsten nicht geprüften Bars. `OVERPASS_URL` überschreibt den primären Overpass-Endpunkt. Standard ist `overpass.osm.ch`, Fallback `overpass-api.de`. `--osm-file /path/response.json` importiert eine gespeicherte vollständige Overpass-Antwort.

### Ablauf und Rücksichtnahme

1. OSM-Stadtgrenze und Standorte per Overpass abfragen; doppelte Node-/Way-Einträge desselben Namens in unmittelbarer Nähe zusammenführen.
2. Hinterlegte Website und zusätzliche Original-Menülinks aus `scraper/menu_urls.json` verwenden.
3. `robots.txt` lesen und respektieren. Bei Fehlern oder unklarer Erlaubnis wird die Website ausgelassen. Crawl-Delay und Request-Rate werden berücksichtigt, mindestens eine Sekunde Pause pro Host. Keine Login-, CAPTCHA- oder Zugriffsschutz-Umgehung.
4. Begrenzt HTML-Menüseiten, eingebettete PDFs und in PDFs verlinkte Unterkarten lesen. Externe Navigation nur für direkt verlinkte PDF-Dateien und den ausdrücklich verlinkten Menüanbieter `api2.lunchgate.ch`; jeder Redirect wird erneut geprüft. Private/Loopback-Adressen und ungewöhnliche Ports werden abgewiesen.
5. Nur Bierzeilen mit expliziter Grösse und zuordenbarem Preis übernehmen. CHF 2–25 und 100–1000 ml sind Plausibilitätsgrenzen. Fehlende Preise werden nie geschätzt.
6. `public/data/bars.json` atomar schreiben. Ein fehlgeschlagener Abruf erhält den letzten bekannten Preis samt ursprünglichem Datum; erfolgreich gelesene, aber preislose Karten können alte Angebote entfernen. Bei teilweise fehlgeschlagenen Crawls können einzelne Angebote fehlen.

Weitere Menülinks ergänzen:

```json
{
  "node/5803645580": ["https://www.bar-rossi.ch/menue/"]
}
```

Der Schlüssel ist die bestehende OSM-ID. Preise oder Koordinaten müssen dafür nicht manuell erfunden werden. Fehlende Locations und Websites können direkt in OpenStreetMap ergänzt werden; der nächste Import übernimmt sie.

## GitHub Actions

- **Checks:** Frontend-Tests, TypeScript/Produktionsbuild und Python-Tests bei Push und Pull Request.
- **Refresh Zurich beer prices:** montags um 04:23 UTC und manuell unter Actions. Aktualisiert Standorte und Preise und committet den Datenbestand. Benötigt die im Workflow deklarierte Schreibberechtigung für Repository-Inhalte. Private Repositories verwenden das Actions-Kontingent des Accounts.
- **Deploy to GitHub Pages (manual):** optional. Zuerst unter Settings → Pages die Quelle „GitHub Actions“ aktivieren, dann den Workflow starten. Für Pages aus privaten Repositories ist ein passender GitHub-Tarif erforderlich; das Repository wird nicht automatisch öffentlich gemacht. Nach Datenupdates muss dieser manuelle Deployment-Workflow erneut gestartet werden.

## Aufbau

```text
src/main.ts                  Oberfläche, Karte und Interaktionen
src/data.ts                  Filter, Preisnormalisierung, sichere Links
src/style.css                Responsive Gestaltung
public/data/bars.json        Versionierter Datenbestand
scraper/scrape.py            Standortimport, höflicher Crawler, PDF/HTML
scraper/extract.py           Konservative Preisextraktion
scraper/pdf_extract.py       PDF-Spalten, Grössenüberschriften und Textpositionen
scraper/reviewed_menus.json   Geprüfte Bildkarten mit Inhalts-Prüfsummen
scraper/source_scopes.json   Abgrenzung von Filial- und Archivkarten
scraper/menu_urls.json       Zusätzliche Original-Menülinks pro OSM-ID
scraper/additional_venues.json Ausgewählte weitere OSM-Locations und Websites
tests/                      Preis-, Filter- und Parser-Regressionstests
.github/workflows/          CI, Wochenimport, optionales Deployment
```

## Quellen und Nutzung

Standorte: [© OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Die OSM-abgeleiteten Standortdaten bleiben unter dieser Datenbanklizenz. Basiskarte: [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Bierpreise stammen aus den im Datensatz verlinkten Originalkarten. Gespeichert werden strukturierte Preisfakten und kurze Belegzeilen, keine vollständigen Speisekarten. Schriften werden von Google Fonts geladen.

Vor öffentlichem Betrieb die Nutzungsbedingungen und Kapazitätsgrenzen der Kartenanbieter sowie die Anforderungen der eigenen Bereitstellung prüfen. Der Code steht unter MIT; Rechte an den Quelldaten und fremden Inhalten bleiben separat.

## Vercel

Deployment mit der Vercel CLI:

```sh
vercel link --project woguenstig
vercel --prod
```

`vercel.json` konfiguriert den Vite-Build. Der Scraper läuft weiterhin in GitHub Actions; Vercel liefert den eingecheckten Datenbestand statisch aus. Nach Datenupdates erneut deployen oder die GitHub-Integration in Vercel verbinden. `.vercelignore` hält die lokale Python-Umgebung und den Scraper aus dem Deployment-Upload.
