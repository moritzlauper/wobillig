# wobillig 🍻 ☕

Eine einfache Zürich-Karte für Bier-, Kaffee- und Pizza-Margherita-Preise. TypeScript, Leaflet, Python-Scraper und eine Vercel-API für gemeinsam gespeicherte Preise. Keine Registrierung erforderlich.

## Was drin ist

- Umschalter **Bier / Kaffee / Pizza Margherita**, mit Direktlinks unter `?drink=coffee` und `?drink=pizza`.
- Kaffee nach Sorte vergleichen: Café crème/Kaffee, Espresso, doppelter Espresso, Ristretto, Cappuccino, Latte macchiato, Milchkaffee/Caffè latte, Flat White, Americano und Filterkaffee. Preise gelten **pro Getränk**, ohne erfundene Tassengrössen oder 5-dl-Umrechnung.
- Interaktive Karte und synchronisierte Liste mit echten OpenStreetMap-Standorten.
- Suche nach Bar, Strasse und Postleitzahl; Filter für Preis, Portionsgrösse, Bar/Pub/Biergarten/Restaurant/Café, Terrasse und alkoholfreies Bier.
- Grössenfilter **Stange / 3 dl** und **5 dl**. Die Stangen-Auswahl zeigt den tatsächlichen Glaspreis und ist unter `?size=stange` direkt verlinkbar. Sie enthält 3-dl-Angebote sowie ausdrücklich als Stange bezeichnete 3–3.3-dl-Portionen oder Angebote ohne Mengenangabe. Bekannte 2-dl-Portionen sowie alle als Flaschen- oder Dosenbier gekennzeichneten Angebote gehören nicht dazu, auch bei 3 dl.
- **3 / 3.3 dl** zeigt kleine Offenbiere und Flaschen gemeinsam: 3- und 3.3-dl-Angebote sowie Stangen gemäss Stangenfilter, auch ohne Mengenangabe. Die Auswahl aktiviert alle Ausschankarten und den tatsächlichen Portionspreis. Danach lässt sich der Ausschank separat einschränken. Direktlink: `?size=300-330`.
- Startansicht mit **allen Ausschankarten, 3 / 3.3 dl und maximal CHF 15**, einschliesslich Lokalen ohne passenden Preis. Zurücksetzen stellt diese Standardfilter wieder her. Ausschank und Grösse sind direkt oben wählbar, auf dem Handy in zwei nebeneinanderliegenden Feldern. Bei Flaschen- oder Dosenbier wechselt eine aktive Stangen-Auswahl auf „Alle Grössen“. Über „Genau 3 dl“ lässt sich die Stangen-Suche zusätzlich auf belegte 3 dl beschränken.
- Standardvergleich nach **tatsächlichem Glaspreis**, optional auf 5 dl umgerechnet. Ein kleineres Glas wird damit nicht automatisch zum besseren Deal. Die Stangen-Direktwahl und der 3-dl-Filter wechseln automatisch zum Glaspreis. Stangen ohne Mengenangabe zeigen „Grösse nicht angegeben“ und werden aus dem rechnerischen 5-dl-Vergleich ausgeschlossen.
- Sortierung nach Preis, Name oder Entfernung nach freiwilliger Standortfreigabe. Der Standort bleibt im Browser.
- **Offenbier / Flaschenbier / Dosenbier / Ausschankart unbekannt** in der Liste und in den Preisdetails. Die Kartenmarker zeigen nur den Preis. Ausschank-Filter und Auswahl beim Eintragen oder Korrigieren eines Bierpreises.
- Quellenlink, Portionsgrösse und Abrufdatum für jedes gefundene Angebot.
- **Teilen** in den Lokaldetails öffnet das native Teilen-Menü. Der Direktlink öffnet das Lokal samt Karte und Preisen; Kaffee- und Stangenansicht bleiben erhalten. Ohne native Unterstützung wird der Link kopiert oder zum manuellen Kopieren angezeigt.
- Bars ohne passenden Preis bleiben optional auf der Karte sichtbar.
- Mobile Karten-/Listenansicht, Tastaturbedienung und Datenabdeckung.
- **Preis eintragen**, **Preis hinzufügen** und **Ändern**: Bier, Kaffee und Pizza Margherita bei bekannten Lokalen ergänzen oder korrigieren. Alle Besucher sehen die gespeicherten Preise. Änderungen werden getrennt vom Scraper gespeichert und als ungeprüfte Einträge gekennzeichnet.
- Scraping-Workflow alle zwei Wochen, CI und optionaler GitHub-Pages-Workflow.

## Ehrlicher Datenstand

Der Datenstand vom **15. Oktober 2026** enthält **430 Locations** in der administrativen Stadt Zürich und **1’385 Bierangebote bei 194 Locations**. Unter den **229 als Bar erfassten Lokalen haben 44 einen Bierpreis** (vor der gezielten Bar-Nachsuche: 28); 32 davon haben einen alkoholhaltigen 5-dl-Preis bis CHF 15. Dazu kommen 18 von 61 Pubs mit Preisen. Die Nachsuche prüft zusätzlich Restaurants und Cafés aus OpenStreetMap. Mehrdeutige Mengen-/Preistabellen und doppelte Produktvarianten wurden bereinigt; grafische Karten wurden anhand des PDF-Layouts geprüft. Dies sind Quellendaten, keine Demo-Preise. Die Zahlen ändern sich bei späteren Läufen.

Die Bar-Nachsuche ergänzt 181 Angebote bei 16 Bars und drei Pubs, unter anderem Bar 63, Cinchona, Kasheme, Kunsthaus Bar, Widder, Metropol und Terrasse. Fehlende oder veraltete Website-Adressen und direkte Menülinks sind für folgende Läufe hinterlegt. Kombinierte Wein-/Getränkekarten, Cocktail-Unterseiten, www-Weiterleitungen, grössere PDFs bis 24 MiB und zusätzliche HTML-/Tabellenformate werden berücksichtigt. Bekannte Quellen werden erneut geprüft; bei nicht erreichbaren oder im begrenzten Lauf nicht besuchten Quellen bleiben ihre bisherigen Preise mit dem ursprünglichen Abrufdatum erhalten. Die verbleibenden 185 Bars ohne Preis werden nicht mit Schätzpreisen aufgefüllt.

Beispiele für echte 5-dl-Portionen aus den Originalkarten: Rheinfelder Bierhalle CHF 6.80, New Bombay (Erdinger) CHF 6.90, Amara CHF 6.80, Zum Guten Glück (Adler Lager) CHF 6.80 und La Stazione in Oerlikon CHF 5.50. Im El Lokal erkennt der Parser jetzt auch das Appenzeller vom Fass für CHF 8.50. Die Quellen sind direkt beim jeweiligen Angebot verlinkt.

„Möglichst jede Bar“ umfasst alle benannten OSM-Objekte mit `amenity=bar`, `pub` oder `biergarten` innerhalb der Stadtgrenze. Ergänzend werden ausgewählte Bierhallen, Restaurants und Cafés aus `scraper/additional_venues.json` bei jedem OSM-Import berücksichtigt. Koordinaten und Typ kommen weiterhin aus OSM; optional ergänzte Websites sind in dieser Datei erkennbar. Die zusätzliche Suche in `scraper/enrich.py` prüft systematisch Restaurants und Cafés mit eigener Website innerhalb derselben Stadtgrenze. Gemeinsame Websites mehrerer Standorte werden ohne expliziten Menühinweis ausgelassen. Nachtclubs werden nicht flächendeckend erfasst. OSM ist unvollständig; ein Standort kann veraltet oder falsch klassifiziert sein. Preise sind nur für einen Teil öffentlich maschinenlesbar. **Vollständigkeit und aktuelle Ausschankpreise sind nicht garantiert.**

Der Scraper folgt auch eingebetteten PDFs, PDF-Inhaltsverzeichnissen und verlinkten Lunchgate-Menüs. Er priorisiert Getränkekarten vor anderen Dokumenten. Der PDF-Parser trennt klare Spalten, liest Grössenüberschriften und ordnet Preise anhand der Textpositionen zu. Explizite Portionsgrössen direkt beim Produkt haben Vorrang. Einheiten, parallele Grössen-/Preislisten, umgebrochene Bierzeilen und Alkoholangaben werden ebenfalls ausgewertet. Auch Preis-vor-Menge-Zeilen und Einheiten mit Schluss-Punkt werden erkannt. Ein Flaschenabschnitt beendet die vorherige Fassbier-Mengenzuordnung; fehlende Flaschengrössen werden nicht übernommen.

Grafische oder mehrdeutige Originalkarten sind zusätzlich in `scraper/reviewed_menus.json` visuell geprüft hinterlegt. Diese Angebote erscheinen als **manuell geprüft** und werden nur bei identischer SHA-256-Prüfsumme der erneut abgerufenen Quelle übernommen. Bei als exklusiv markierten Prüfungen ersetzen diese Einträge die automatische Erkennung für dieselbe Karte. Eine geänderte Datei verlangt eine erneute Prüfung; alte geprüfte Preise daraus werden nicht blind übernommen. `source_scopes.json` verhindert bei bekannten gemeinsamen Websites, dass Karten anderer Filialen oder archivierte Menüs zugeordnet werden.

Mehrdeutige Tabellen, nicht geprüfte Bilder, reine JavaScript-Menüs, fehlende Grössen (ausser ausdrücklich als Stange bepreiste Portionen), Ginger Beer, Mineralwasser gleicher Marken, Catering-Karten, erkannte Liefer-/Bestellseiten, Take-away-Abschnitte und bedingte Angebote werden ausgelassen. 5 dl umfasst Fass-, Flaschen- und gegebenenfalls Dosenbier. Der Ausschank-Filter trennt diese Angebote. Belegte Ausschankarten stammen aus ausdrücklichen Angaben beim Getränk oder einer eindeutig zugeordneten Menüüberschrift. Fehlen solche Angaben, wird die Art separat anhand von Bezeichnung, Grössenvarianten und typischen Gebinden geschätzt. Die Oberfläche zeigt dann «geschätzt» und eine Begründung; der Ausschank-Filter berücksichtigt diese Vermutung. Eine Schätzung überschreibt niemals das ursprüngliche Quellenfeld. Ein Teil der Angebote hat keine eindeutige Angabe in der Quelle. Diese bekommen nach Möglichkeit eine separate Schätzung; nur Angebote ohne plausible Zuordnung bleiben im Filter „Ausschankart unbekannt“. Automatisch erkannte Preise sind als solche markiert. Das Abrufdatum sagt, wann die Quelle gelesen wurde; eine alte PDF kann weiterhin online stehen. Alkoholfrei umfasst entsprechend bezeichnete Produkte und explizite Alkoholangaben bis 0.5 %, nicht ausschliesslich 0.0 %. Die Oberfläche trennt Gesamtangebote von den Locations mit einem zu den aktuellen Filtern passenden Preis.

Auch Bezeichnungen wie **Grosses / Großes** und **Herrgöttli** werden mit ausdrücklich gedruckter Menge und Preis innerhalb eines Bierabschnitts erkannt. Bei PDF-Faltkarten berücksichtigt die Erkennung ungleich breite Spalten, doppelt gezeichnete Überschriften und unmittelbar darunterstehende Brauerei- oder Alkoholfrei-Angaben. Eine Nachprüfung von 37 entsprechenden archivierten Karten ergänzte bzw. korrigierte Angebote bei Mythos, Gertrudhof, Eisenhof und Gabbiano; die ursprünglichen Abrufdaten der wiederverwendeten Quellen bleiben erhalten.

### Stangenpreise

Die Stangen-Auswahl umfasst **204 Angebote**; **97 Locations** haben einen passenden alkoholhaltigen Preis. Die gezielte Stangen-Nachsuche ergänzte 17 Angebote aus Originalkarten, etwa bei Gabbiano, Hot Pasta und Tramblu (je 3 dl für CHF 4.80), Handelshof (3 dl für CHF 5.50) und La Stazione (Stange für CHF 4.50, Menge nicht angegeben). Weitere Stangenpreise stammen aus der Bar-Nachsuche. Die Abrufdaten der wiederverwendeten Originaldokumente bleiben erhalten. Der reguläre Scraper erkennt diese Formate bei künftigen Läufen ebenfalls.

### Pizza Margherita

Karte und Liste zeigen in dieser Kategorie nur erfasste Pizza-Lokale und Lokale mit einem gemeinsamen Pizza-Preiseintrag. Reine Getränke-Lokale werden auch bei «Ohne passenden Preis anzeigen» nicht eingeblendet.

`public/data/pizza.json` enthält am **15. Oktober 2026** **46 belegte Margherita-Preise bei 46 Zürcher Lokalen**. Der erste Durchlauf hat aus 2’187 OSM-Standorten **802 Restaurant-Websites** systematisch abgearbeitet; eine gezielte Nachprüfung ergänzt Filialseiten, mehrspaltige PDFs und Bildkarten. Fehlgeschlagene oder gesperrte Abrufe zählen nicht als erfolgreiche Preisermittlung. Das Prüfprotokoll steht in `scraper/pizza_checks.json`.

Verglichen wird eine **ganze, normale Pizza Margherita im Lokal**. Kinderpizzen, kleine/halbe Portionen, Familienpizzen, separate Spezialvarianten, reine Pinsa-Angebote, bedingte Mittagsangebote und Liefer-/Take-away-Karten werden nicht übernommen. Die Standardgrösse kann je nach Restaurant variieren; eine fehlende Durchmesserangabe wird nicht erfunden. Preisfilter und Sortierung gelten pro Pizza, ohne Getränke- oder Volumenfilter. Die Pizzaansicht startet bei CHF 30; der Preisfilter bleibt je Kategorie erhalten. Einträge und Korrekturen nutzen dieselbe gemeinsame Speicherung wie Getränke.

Der neue Scraper liest HTML und PDF-Karten, prüft Restaurantstandorte getrennt und hält widersprüchliche Preise zurück. `pizza_menu_urls.json` enthält gezielt zugeordnete Originalkarten. Visuell geprüfte Bildkarten, Grössenspalten und mehrdeutige Layouts stehen mit SHA-256-Prüfsumme in `reviewed_pizza_menus.json`; bei einer Änderung werden sie erneut prüfpflichtig. Beispiele: Pizza Züri CHF 17.50 für 1/1 statt CHF 14.50 für 1/2; Il Grappolo CHF 19 für 30 cm statt CHF 14 für die Kinderpizza; Santa Lucia je nach Filialkarte CHF 18 oder CHF 19. Das Abrufdatum belegt den Quellenabruf und garantiert nicht, dass die Karte selbst neu ist. Es wird keine vollständige Marktabdeckung behauptet.

```bash
# Bekannte Standorte aktualisieren und weitere Zürcher Restaurants prüfen
python -m scraper.scrape_pizza --discover --limit 0 --workers 8 --max-pages 6
# Gezielt einzelne Lokale erneut prüfen
python -m scraper.scrape_pizza --discover --only 'Santa Lucia|Margheri'
# Archivierte Dokumente mit ihrem ursprünglichen Abrufdatum auswerten
python -m scraper.scrape_pizza --venues-file scraper/cache/pizza-venues.json --archive-dir scraper/cache/pizza
```

Der vorhandene zweiwöchentliche Vollscan aktualisiert zusätzlich den Pizza-Datensatz. Der reine KI-Scan bleibt auf seine bisherigen Getränkedaten begrenzt.

### Kaffee

`public/data/coffee.json` enthält am **15. Oktober 2026** **791 Kaffeeangebote bei 173 Locations** sowie weitere Cafés ohne belegten Preis: insgesamt **528 Standorte** einschliesslich Plüsch. Die Erweiterung durchsucht aktuelle Originalseiten direkt und wertet vorhandene Dokumente erneut aus. Die Anzahl bezieht sich auf alle Sorten; der aktuelle Sortenfilter zeigt die dazu passenden Preise. Der Kaffee-Scraper prüft neben Bars auch Restaurants und Cafés innerhalb der Zürcher Stadtgrenze. Er übernimmt nur vollständig erkannte Kaffeenamen mit eindeutigem Preis (CHF 2–12). Einfache und doppelte Espressi bleiben getrennt; Caffè latte wird als Milchkaffee klassifiziert. Allgemein als „Kaffee“ bezeichnete Angebote sind mit Café crème gruppiert; der Originalname bleibt sichtbar. Eisgetränke, alkoholische Kaffees, Aufpreise und Kombiangebote werden nicht als Standardkaffee aufgenommen. Fehlende Sorten können als „Preis offen“ angezeigt werden. Die Kaffeeansicht enthält zusätzlich alle gefundenen OSM-Cafés, auch ohne öffentliche Preise. Diese bleiben als „Preis offen“ sichtbar und können von Besuchern ergänzt werden; fehlende Preise werden nicht erfunden. Neue Restaurants werden erst mit belegten Kaffeepreisen aufgenommen. Bars und Pubs (`bar`, `pub`) sowie Imbisse (`fast_food`) sind in der Kaffeeansicht standardmässig ausgeblendet, auch mit Kaffeepreisen oder aktiviertem «Ohne passenden Preis anzeigen». Im Lokalfilter heisst diese Vorauswahl «Ohne Bars, Pubs / Imbisse». Mit der ausdrücklichen Auswahl «Bar / Pub» oder «Imbiss» werden die jeweiligen Lokale eingeblendet; die übrigen Preisfilter gelten weiterhin. Bars und Pubs bilden in allen Kategorien eine gemeinsame Lokalauswahl «Bar / Pub».

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

`dist/` enthält das statische Frontend. Die vollständige App benötigt zusätzlich `api/prices.ts`. Für einen Unterpfad: `npm run build -- --base=/wobillig/`.

## Scraper starten

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r scraper/requirements.txt
python -m unittest discover -s tests -p 'test_*.py'

# Standorte neu aus OSM laden und alle verlinkten Menüs prüfen
python -m scraper.scrape --discover

# Vertiefte Nachsuche für Bars/Pubs ohne Preise (auch im regulären Workflow)
python -m scraper.scrape --type bar --type pub --type biergarten --missing-prices --max-pages 20

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
- **Refresh Zurich drink prices:** alle zwei Wochen montags um 04:23 UTC (ab 19. Oktober 2026) und jederzeit manuell unter Actions. Aktualisiert Standorte und bekannte Preise, prüft danach alle eindeutig zuordenbaren Gastronomie-Websites für Bier und Kaffee mit bis zu zehn Dokumenten pro Kandidat. Kaffee und zusätzliche Bier-Locations verwenden maximal acht parallele Abrufe; robots.txt, Pausen und Grössenlimits gelten weiterhin. Der Lauf committet beide Datenbestände samt Prüfstand und hat ein Limit von 180 Minuten. Benötigt die im Workflow deklarierte Schreibberechtigung für Repository-Inhalte. Private Repositories verwenden das Actions-Kontingent des Accounts.
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
vercel link --project wobillig
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
vercel blob create-store wobillig-prices --access private --region fra1 --yes
vercel deploy --prod --yes
```

`.env.local` bleibt ignoriert. GitHub Pages kann nur den statischen Datenbestand darstellen; für öffentlich gespeicherte Einträge ist das Vercel-Deployment erforderlich.

`npm run test:storage` prüft den verbundenen Blob-Store mit temporären, anschliessend gelöschten Testobjekten. Dazu muss `.env.local` vorhanden sein. Der Test prüft aufeinanderfolgende und gleichzeitige Schreibvorgänge inklusive Versionskonflikten und wachsender Historie. Im normalen Testlauf wird dieser Integrationstest übersprungen.

## Claude-Scans in GitHub Actions

Das Repository-Secret `ANTHROPIC_API_KEY` wird ausschliesslich dem KI-Scan-Schritt übergeben. Es gehört weder in den Browser noch in Vercel oder die Daten-Dateien. `Refresh Zurich drink prices` aktualisiert Bier und Kaffee **alle zwei Wochen montags um 04:23 UTC**, beginnend am **19. Oktober 2026**, und führt nach der normalen Suche den Claude-Scan aus. Der wöchentliche Zeitplan überspringt über einen festen 14-Tage-Rhythmus jeden zweiten Montag, auch über Jahreswechsel hinweg. Manuelle Läufe sind jederzeit möglich; auswählbar sind `full`, `ai_only`, `estimates_only` und `photos_only`.

`python -m scraper.ai_scan --discover` sucht zusätzliche Zürcher Restaurants/Cafés, folgt Menülinks und liest HTML, PDF-Seiten samt Bildern sowie direkt verlinkte Menübilder. Derselbe Aufruf sammelt Bier und Kaffee. Ausschliesslich Claude Haiku 5.5 (`claude-haiku-5-5`) liefert strukturierte Ergebnisse; Mengen, Preise, Quellenzuordnung und Preisbelege werden zusätzlich validiert. Bestehende widersprechende Preise werden nicht automatisch ersetzt. Neue KI-Preise tragen «KI-erkannt · nicht geprüft», Quellenlink, Abrufdatum, Dokument-Hash und gegebenenfalls PDF-Seite. KI-Erkennung kann dennoch fehlerhaft sein.

Unbekannte Ausschankarten erhalten `beerTypeEstimate` (Typ, konkrete Begründung, Methode), während `beerType` unverändert bleibt. Der KI-Scan übergibt bei HTML-Menüs zusätzlich bis zu zwölf eindeutig einer bepreisten Bierzeile zugeordnete Produktbilder (höchstens 6 MB insgesamt). Bildgestützte Schätzungen speichern `sourceImage` und haben Vorrang vor Mengen-Heuristiken; Nachbarprodukte, mehrdeutige Bildzuordnungen und fehlgeschlagene Bildabrufe dürfen keinen Bildnachweis liefern. Preis, Menge und Alternativen dienen als zusätzliche Hinweise, ein einzelnes günstiges 5-dl-Bier belegt kein Offenbier. Die konkrete KI-Begründung bleibt erhalten. Preise und Mengen werden nicht geschätzt. Biermischgetränke (Panaché/Panash, Henaché, Radler, Shandy usw.) sind vom Biervergleich ausgeschlossen, auch unter einer Offenbier-Überschrift. Gemischte Angebotszeilen wie „Lager / Panaché“ werden vorsichtshalber ebenfalls ausgelassen. Der Ausschluss gilt für Extraktion, geprüfte Menüs, bestehende Daten, Besucherbeiträge und Anzeige. Offenbier-Schätzungen brauchen eine konkrete Ausschankangabe, eine benannte Bierportion oder passende Grössen desselben Biers auf derselben Karte ohne widersprechenden Verpackungsbeleg. Unbelegte KI-Offenbier-Schätzungen werden bei der Aktualisierung entfernt. Häufigkeiten einer Portionsgrösse in anderen Lokalen rechtfertigen keine Ausschank-Schätzung. Besucherkorrekturen haben Vorrang, ihre Angebotsschlüssel hängen nicht an einer Schätzung.

Feste Obergrenze pro Lauf: **1.00 USD API-Tokenkosten**, auch bei höheren CLI-/Workflow-Eingaben. Nur **Haiku 5.5**, kein anderes Modell und kein Fallback. Weitere Grenzen: 1000 Generierungen, 8 Dokumente pro Lokal, 60 Minuten KI-Menüsuche im Workflow. Vor jeder Generierung werden Tokens gezählt und maximale Kosten unter einem gemeinsamen Lock reserviert. Fehlgeschlagene Requests behalten ihre Reservierung; Generierungen werden nicht automatisch wiederholt. Prompts über 100’000 Tokens werden abgelehnt. Preisbasis: [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), 0.10 USD / Mio. Eingabe- und 0.50 USD / Mio. Ausgabetokens bis 100’000 Eingabetokens, ohne Steuern. Die Reservierung verwendet vorsichtshalber sogar den höheren Tarif (0.50 / 2.50 USD) plus Tokenpuffer. Historische Quellen behalten ihre damalige Modellangabe. Öffentliche Quellen und Extrakte werden an Anthropic gesendet; keine Besucher- oder Community-Daten. Der Anbieter-Schlüssel wird nur an `api.anthropic.com` gesendet.

Textreiche PDF-Abschnitte ohne Hinweise auf Bier, Kaffee oder passende Portionsgrössen werden übersprungen; Seiten ohne brauchbaren Text gehen an die Bilderkennung. Identische Dokumente werden pro Lokal nur einmal verarbeitet. Cafés ohne Kaffeepreise werden zuerst geprüft. Ein Inhalts-Cache verhindert erneute API-Kosten für identische Dokumente/Prompts. `scraper/ai_checks.json` lässt spätere Läufe zu noch nicht geprüften Lokalen weitergehen. Ein Bericht mit Kosten, Treffern und Fehlern steht im Actions-Lauf und als Artefakt. Bei fehlendem Schlüssel bleibt der normale Scraper verwendbar; bei API-/Netzwerkfehlern werden vorhandene Angebote erhalten. Robots-Regeln und bestehende Filial-/Quellenbeschränkungen gelten weiterhin.

## Datierte Google-Maps-Menüfotos

Der OCR-Scan verarbeitet zusätzlich die einzeln geprüften Quellen in `scraper/menu_photos.json`. Er nutzt denselben Haiku-5.5-Client und **dasselbe gesamte Limit von 1.00 USD** wie die übrige KI-Suche. `photos_only` in Actions bzw. `python -m scraper.ai_scan --photos-only` prüft nur diese Fotos.

Die Suche und Datumsprüfung in Google Maps sind derzeit **manuell**, die anschliessende OCR und Übernahme laufen automatisch. Die [offizielle Photo-API](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#Photo) bietet kein Foto-Datumsfeld; sie kann die Sechsmonatsgrenze nicht allein belegen. Dies ist kein flächendeckender Google-Maps-Crawler. Nur am einzelnen Foto geprüfte Datumsangaben zählen, niemals das Datum einer Rezension, das Abrufdatum oder ein vom Modell geratenes Datum. Stimmen Aufnahme- und Veröffentlichungsangabe nicht überein, ist die ältere Angabe massgeblich.

Pro Quelle: OSM-`barId`, direkter Maps-Fotolink, beobachtete `imageUrl`, `photoDate` (`YYYY-MM-DD` oder `YYYY-MM`), `dateEvidence`, `dateCheckedAt`, `venueConfirmed: true`, `isMenu: true`. Die Zuordnung wird am Lokalnamen und Standort geprüft. Bei Monatsangaben zählt vorsichtshalber der Monatserste: am 15.10.2026 ist ein Foto vom 15.04.2026 zulässig, ein nur mit „April 2026“ datiertes Foto hingegen nicht. Fehlende, zukünftige und zu alte Datierungen werden **vor** dem Bildabruf und jeder API-Anfrage verworfen.

Wenn ein direkter automatischer Bildabruf durch robots.txt ausgeschlossen ist, kann ein einzeln im Browser ausgewähltes Foto als `imagePath` unter `scraper/photo_inputs/` mit passender `sha256` importiert werden. Diese Dateien sind von Vercel ausgeschlossen und werden nicht auf der Website gespiegelt. Quellen dürfen keine Zugangssperren umgehen. Der erste importierte Beleg ist die vom Lokal veröffentlichte Kaffeekarte von 169 West, datiert September 2026.

OCR-Preise behalten den Fotolink, das Fotodatum, den Textbeleg und das separate Lesedatum. Unlesbare Ziffern, Strichlisten, Spenden, rückseitig durchscheinender Text und unklare Portionsgrössen werden nicht als Preise übernommen. Bestehende widersprechende Preise werden nicht automatisch ersetzt. Abgelaufene Fotoangebote verschwinden aus dem Kartenvergleich und der Detailansicht auch ohne neuen Scan; der nächste Scan entfernt sie aus dem Datensatz. Ein neuer Besucherpreis bleibt unabhängig davon erhalten.

Im Biervergleich erscheinen Cafés nur mit einem aktuellen, vergleichbaren Bierangebot im Datensatz (einschliesslich Besucherbeiträgen). Cafés, deren hinterlegte Öffnungszeiten an keinem Tag über 19 Uhr hinausreichen, werden auch mit Bierpreisen ausgeblendet. Unbekannte Öffnungszeiten allein führen nicht zum Ausschluss. Diese Vorauswahl gilt für Liste, Karte und ausgewählte Lokale unabhängig von «Ohne passenden Preis anzeigen»; Kaffee und Pizza sind davon ausgenommen.
