# wogünstig 🍻

**Gutes Bier. Guter Preis.** Eine schlichte, responsive Zürich-Karte für den nächsten Feierabend. TypeScript, Leaflet und ein Python-Scraper – ohne API-Key, Benutzerkonto oder eigenes Backend.

## Was drin ist

- Interaktive Karte und synchronisierte Liste mit echten OpenStreetMap-Standorten.
- Suche nach Bar, Strasse und Postleitzahl; Filter für Preis, Portionsgrösse, Bar/Pub/Biergarten, Terrasse und alkoholfreies Bier.
- Vergleich nach Glaspreis oder **rechnerischem Preis pro 5 dl**. Ein kleineres Glas wird damit nicht automatisch zum besseren Deal.
- Sortierung nach Preis, Name oder Entfernung nach freiwilliger Standortfreigabe. Der Standort bleibt im Browser.
- Quellenlink, Portionsgrösse und Abrufdatum für jedes gefundene Angebot.
- Bars ohne passenden Preis bleiben optional auf der Karte sichtbar.
- Mobile Karten-/Listenansicht, Tastaturbedienung und transparente Datenabdeckung.
- Wöchentlicher Scraping-Workflow, CI und optionaler GitHub-Pages-Workflow.

## Ehrlicher Datenstand

Der erste Import vom **14. Oktober 2026** enthält **293 Locations** in der administrativen Stadt Zürich, davon **178 mit Website in OpenStreetMap**. Nach konservativer Bereinigung gibt es **51 Preisangebote bei 13 Locations**. Dies sind echte Quellendaten, keine Demo-Preise. Die Zahlen ändern sich bei späteren Läufen.

„Möglichst jede Bar“ bedeutet hier: alle benannten OSM-Objekte mit `amenity=bar`, `pub` oder `biergarten` innerhalb der Stadtgrenze. Restaurants, Cafés und Nachtclubs, die in OSM nicht zusätzlich als Bar erfasst sind, gehören nicht zur Abfrage. OSM ist unvollständig; ein Standort kann veraltet oder falsch klassifiziert sein. Preise sind nur für einen Teil der Bars öffentlich maschinenlesbar. **Vollständigkeit und aktuelle Ausschankpreise sind nicht garantiert.**

Der Parser lässt mehrdeutige Tabellen, Bilder, reine JavaScript-Menüs, fehlende Grössen, Ginger Beer, Catering-Karten und bedingte Angebote aus. Automatisch erkannte Preise sind ausdrücklich als solche markiert. Das Abrufdatum sagt, wann die Quelle gelesen wurde; eine alte PDF kann weiterhin online stehen. Alkoholfrei umfasst entsprechend bezeichnete Produkte und explizite Alkoholangaben bis 0.5 %, nicht ausschliesslich 0.0 %.

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

`--max-pages 5` begrenzt die Dokumente pro Bar, `--workers` die Parallelität (maximal 8). Begrenzte Läufe beginnen mit den am längsten nicht geprüften Bars. `OVERPASS_URL` überschreibt den primären Overpass-Endpunkt. Standard ist `overpass.osm.ch`, Fallback `overpass-api.de`. `--osm-file /path/response.json` importiert eine gespeicherte vollständige Overpass-Antwort.

### Ablauf und Rücksichtnahme

1. OSM-Stadtgrenze und Standorte per Overpass abfragen; doppelte Node-/Way-Einträge desselben Namens in unmittelbarer Nähe zusammenführen.
2. Hinterlegte Website und zusätzliche Original-Menülinks aus `scraper/menu_urls.json` verwenden.
3. `robots.txt` lesen und respektieren. Bei Fehlern oder unklarer Erlaubnis wird die Website ausgelassen. Crawl-Delay und Request-Rate werden berücksichtigt, mindestens eine Sekunde Pause pro Host. Keine Login-, CAPTCHA- oder Zugriffsschutz-Umgehung.
4. Begrenzt HTML-Menüseiten und direkt verlinkte PDF-Karten lesen. Externe Navigation nur für direkt verlinkte PDF-Dateien, jeder Redirect wird erneut geprüft. Private/Loopback-Adressen und ungewöhnliche Ports werden abgewiesen.
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
scraper/menu_urls.json       Zusätzliche Original-Menülinks pro OSM-ID
tests/                      Preis-, Filter- und Parser-Regressionstests
.github/workflows/          CI, Wochenimport, optionales Deployment
```

## Quellen und Nutzung

Standorte: [© OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Die OSM-abgeleiteten Standortdaten bleiben unter dieser Datenbanklizenz. Basiskarte: [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Bierpreise stammen aus den im Datensatz verlinkten Originalkarten. Gespeichert werden strukturierte Preisfakten und kurze Belegzeilen, keine vollständigen Speisekarten. Schriften werden von Google Fonts geladen.

Vor öffentlichem Betrieb die Nutzungsbedingungen und Kapazitätsgrenzen der Kartenanbieter sowie die Anforderungen der eigenen Bereitstellung prüfen. Der Code steht unter MIT; Rechte an den Quelldaten und fremden Inhalten bleiben separat.
