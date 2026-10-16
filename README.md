# wobillig 🍻 ☕

Eine einfache Karte für Bier-, Kaffee- und Pizza-Margherita-Preise in Zürich, Bern und Basel. TypeScript, Leaflet, Python-Scraper und eine Vercel-API für gemeinsam gespeicherte Preise. Keine Registrierung erforderlich.

## Städte und Aktualisierung

### Suchmaschinen und Search Console

`npm run build` erzeugt bereits lesbares HTML für Zürich (`/`), Basel (`/basel`) und Bern (`/bern`): eindeutige Titel und Beschreibungen, H1, Preisübersichten mit Quellen, Canonical-URLs, Social-Metadaten und strukturierte Daten (`WebSite`, `CollectionPage`). Eine 26 Pixel hohe, auch mobil einzeilige Kopfzeile zeigt die Kategorie und Stadt. Der Link «Ranglisten» zur Kaffee-Preisübersicht steht in der Listenansicht oberhalb der Sortierung; mobil wird er nach einem Klick auf «Liste» sichtbar. Bei einem Wechsel auf Bier oder Pizza passen sich die Überschrift und der Browser-Seitentitel an; bei Kaffee gilt wieder der SEO-Seitentitel. Die Preisübersichten bleiben auch nach dem Start der interaktiven Karte sichtbar.

Zusätzlich entstehen sechs direkt verlinkte, ohne JavaScript nutzbare Preisvergleichsseiten: `/espresso-zuerich`, `/cappuccino-zuerich`, `/espresso-basel`, `/cappuccino-basel`, `/espresso-bern`, `/cappuccino-bern`. Sie zeigen je Sorte die günstigsten 25 erfassten Lokale, Anzahl, Preisspanne, Durchschnitt und Quellen. Die Auswahl verwendet dieselben Kaffeesorten und Gültigkeitsregeln wie die Karte; pro Lokal zählt ein Preis. Es wird keine vollständige Marktabdeckung behauptet. Community-Korrekturen werden in der Karte laufend geladen; die statischen Übersichten verwenden die JSON-Daten des Builds.

Die öffentliche Hauptdomain ist `https://wobillig.ch` (`src/seo.ts`); bei einem Domainwechsel kann `SITE_URL` beim Build einen anderen HTTPS-Origin vorgeben. `dist/sitemap.xml` enthält alle neun kanonischen Seiten; `dist/robots.txt` verweist darauf. Filter- und Lokal-URLs bleiben bedienbar und verweisen per Canonical auf ihre Stadtseite. Vercel leitet `/index.html`-Varianten und abschliessende Slashes auf die sauberen URLs weiter.

Nach dem Deployment in Google Search Console die Domain bestätigen und `https://wobillig.ch/sitemap.xml` einreichen. Mit der URL-Prüfung `/`, `/basel`, `/bern` und die sechs Preisvergleichsseiten prüfen. Die Sitemap und das HTML entstehen automatisch bei jedem Build; ein Daten-Refresh mit anschliessendem Deployment aktualisiert auch die statischen Preise. Indexierung und Rankings entscheidet die Suchmaschine.

Zürich liegt unter `/`, Bern unter `/bern`, Basel unter `/basel` (auch mit abschliessendem Slash). Die kleinen Stadtlinks in der Statuszeile wechseln die Stadt und behalten alle Filter sowie die Sortierung bei: Kategorie, Kaffeesorte, Suchtext, Preislimit, Biergrösse, Ausschank, Lokaltyp, fehlende Preise, Draussen, Alkoholfrei, Preisumrechnung und Günstig-Modus. Die Auswahl wird in der URL gespeichert; ein ausgewähltes Lokal wird beim Stadtwechsel verworfen. «Günstig» berechnet seine Preisgrenze in der Zielstadt neu. Standortkoordinaten werden nicht in die URL geschrieben; für Entfernungssortierung ist dort erneut ein Standort nötig. Pizza Margherita erscheint erst ab 20 Lokalen mit einem aktuellen Margherita-Preis in der jeweiligen Stadt (inklusive gemeinsamer Einträge, unabhängig von Suchfiltern). Bei weniger Ergebnissen wechseln Pizza-Direktlinks auf Kaffee; der Scraper erfasst weiter Preise. Dort steht auch «Wird alle 3 Wochen aktualisiert».

Alle drei Städte werden durch denselben vollständigen Workflow aktualisiert: alle 21 Tage montags um 04:23 UTC, erstmals am 19. Oktober 2026, danach am 9. und 30. November. Die Städte laufen nacheinander; ein Fehler in einer Stadt verhindert die anderen nicht. Das bestehende KI-Gesamtbudget und das Request-Limit werden auf die drei Städte verteilt. Der Zeitplan wird aktiv, sobald die Workflow-Änderung im Standardbranch liegt.

`WOBILLIG_CITY=bern` bzw. `WOBILLIG_CITY=basel` wählt die Stadt für **alle** Scraper-Module; ohne Variable bleibt Zürich aktiv. Beispiel:

```sh
WOBILLIG_CITY=bern python -m scraper.scrape --discover
WOBILLIG_CITY=bern python -m scraper.enrich --limit 0 --max-pages 10
WOBILLIG_CITY=bern python -m scraper.scrape_coffee --discover --limit 0
WOBILLIG_CITY=bern python -m scraper.scrape_pizza --discover --limit 0
WOBILLIG_CITY=bern python -m scraper.locations
```

Die neuen Datensätze liegen unter `public/data/bern/` und `public/data/basel/`; Prüfstände unter `scraper/cities/<stadt>/`. Vorhandene Zürich-Pfade bleiben bestehen. Community-Einträge werden pro Stadt in eigenen Blob-Dateien gespeichert; Zürich verwendet weiterhin seine bisherigen Dateien. Vercel bedient die Stadtpfade direkt über `index.html`.

## Was drin ist

- Umschalter **Kaffee / Bier / Pizza Margherita**. Kaffee ist in allen Städten die Standardansicht und steht links; Cappuccino ist vorausgewählt und wird beim Zurücksetzen wieder gewählt; direkte Kategorienlinks verwenden `?drink=coffee`, `?drink=beer` oder `?drink=pizza`. Ältere Bierlinks mit `?size=…` bzw. `?beerType=…` bleiben gültig.
- Kaffee nach Sorte vergleichen: Café crème/Kaffee, Espresso, doppelter Espresso, Ristretto, Cappuccino, Latte macchiato, Milchkaffee/Caffè latte, Flat White, Americano und Filterkaffee. Preise gelten **pro Getränk**, ohne erfundene Tassengrössen oder 5-dl-Umrechnung.
- Interaktive Karte und synchronisierte Liste mit echten OpenStreetMap-Standorten.
- Suche nach Bar, Strasse und Postleitzahl; Filter für Preis, Portionsgrösse, Bar/Pub/Biergarten/Restaurant/Café, Terrasse und alkoholfreies Bier.
- Grössenfilter **Stange / 3 dl** und **5 dl**. Die Stangen-Auswahl zeigt den tatsächlichen Glaspreis und ist unter `?size=stange` direkt verlinkbar. Sie enthält 3-dl-Angebote sowie ausdrücklich als Stange bezeichnete 3–3.3-dl-Portionen oder Angebote ohne Mengenangabe. Bekannte 2-dl-Portionen sowie alle als Flaschen- oder Dosenbier gekennzeichneten Angebote gehören nicht dazu, auch bei 3 dl.
- **3 / 3.3 dl** zeigt kleine Offenbiere und Flaschen gemeinsam: 3- und 3.3-dl-Angebote sowie Stangen gemäss Stangenfilter, auch ohne Mengenangabe. Die Auswahl aktiviert alle Ausschankarten und den tatsächlichen Portionspreis. Danach lässt sich der Ausschank separat einschränken. Direktlink: `?size=300-330`.
- Bieransicht mit **allen Ausschankarten, 3 / 3.3 dl und maximal CHF 15**, einschliesslich Lokalen ohne passenden Preis. Zurücksetzen stellt diese Standardfilter wieder her. Ausschank und Grösse sind direkt oben wählbar, auf dem Handy in zwei nebeneinanderliegenden Feldern. Bei Flaschen- oder Dosenbier wechselt eine aktive Stangen-Auswahl auf „Alle Grössen“. Über „Genau 3 dl“ lässt sich die Stangen-Suche zusätzlich auf belegte 3 dl beschränken.
- Standardvergleich nach **tatsächlichem Glaspreis**, optional auf 5 dl umgerechnet. Ein kleineres Glas wird damit nicht automatisch zum besseren Deal. Die Stangen-Direktwahl und der 3-dl-Filter wechseln automatisch zum Glaspreis. Stangen ohne Mengenangabe zeigen „Grösse nicht angegeben“ und werden aus dem rechnerischen 5-dl-Vergleich ausgeschlossen.
- **Schnitt Zürich / Bern / Basel CHF …** steht prominent in der Statuszeile. Der stadtweite Durchschnitt zählt den günstigsten passenden Preis je Lokal für die gewählte Sorte, Biergrösse, Ausschankart und Alkoholfrei-Auswahl; die 5-dl-Umrechnung wird berücksichtigt. Suche, Preislimit, Günstig-Modus, Lokaltyp und Draussen-Filter verändern diesen Vergleichswert nicht. Fehlende oder abgelaufene Preise zählen nicht mit; ohne Treffer erscheint ein Strich. Der Hinweis am Wert und «Daten» erklären die Berechnung.
- Sortierung nach Preis, Name oder Entfernung nach freiwilliger Standortfreigabe. Der Standort bleibt im Browser.
- **Offenbier / Flaschenbier / Dosenbier / Ausschankart unbekannt** in der Liste und in den Preisdetails. Die Kartenmarker zeigen nur den Preis. Ausschank-Filter und Auswahl beim Eintragen oder Korrigieren eines Bierpreises.
- Quellenlink, Portionsgrösse und Abrufdatum für jedes gefundene Angebot.
- **Daten herunterladen** im Datenfenster: CSV (UTF-8 mit BOM, Semikolon, eine Zeile je Angebot) und JSON für die aktuelle Stadt, alle Kategorien ohne UI-Filter. Originalpreise, Mengen, Quellen, Datum, Prüfstatus und gemeinsame Korrekturen sind enthalten. CSV kennzeichnet abgelaufene und nicht vergleichbare Angebote sowie geschätzte Ausschankarten; JSON bewahrt vollständige Angebotsdetails und Lokale ohne Preise. Fehlende Kategorien oder nicht geladene gemeinsame Einträge werden im Fenster und Export ausgewiesen. Standortattribution bleibt enthalten.
- **Teilen** in den Lokaldetails öffnet das native Teilen-Menü. Der Direktlink öffnet das Lokal samt Karte und Preisen; Kaffee- und Stangenansicht bleiben erhalten. Ohne native Unterstützung wird der Link kopiert oder zum manuellen Kopieren angezeigt.
- Bars ohne passenden Preis bleiben optional auf der Karte sichtbar.
- Mobile Karten-/Listenansicht, Tastaturbedienung und Datenabdeckung.
- Ein Lokal auf der Karte oder in der Liste anklicken, dann **Preis hinzufügen** oder **Ändern**: Bier, Kaffee und Pizza Margherita ergänzen oder korrigieren. Das Lokal ist im Formular bereits festgelegt. Alle Besucher sehen die gespeicherten Preise. Änderungen werden getrennt vom Scraper gespeichert und als ungeprüfte Einträge gekennzeichnet.
- **Lokale direkt auf der Karte auswählen:** Im Nahzoom (ab Stufe 17) markieren orange Plus-Symbole weitere OSM-Lokale. Ein Klick öffnet das Preisformular mit Name und Standort. Auch ein Klick auf den Namen im Kartenbild sucht nahe Lokale; bei mehreren Treffern erscheint eine Auswahl. Bier, Kaffee und Pizza Margherita sind im selben Formular wählbar.
- Scraping-Workflow alle drei Wochen, CI und optionaler GitHub-Pages-Workflow.

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

Karte und Liste zeigen in dieser Kategorie erfasste Pizza-Lokale und Lokale mit einem gemeinsamen Pizza-Preiseintrag. Die Erkennung berücksichtigt OSM-`cuisine=pizza`, den Namen, bestätigte Pizzeria-Webseitentitel und gefundene Pizza-Angebote. Bekannte Pizzerien bleiben auch ohne Website oder erkannten Preis sichtbar. Reine Getränke-Lokale werden auch bei «Ohne passenden Preis anzeigen» nicht eingeblendet.

`public/data/pizza.json` enthält nach dem vertieften Zürcher Neulauf am **16. Oktober 2026** **182 erfasste Pizza-Lokale, davon 82 mit belegtem Margherita-Preis** (vor der OCR- und Menüsuche-Erweiterung: 55 mit Preis; **27 zusätzliche Treffer, +49 %**). Der vorausgehende Discovery-Lauf prüfte **952 Websites** aus 2’187 OSM-Standorten. Anschliessend wurden die Pizzerien ohne Preis mit der erweiterten Auslese erneut geprüft. OSM kennzeichnet 144 Standorte ausdrücklich mit `cuisine=pizza`; diese Information bleibt jetzt erhalten. Alle zuvor erfassten Preis-Lokale blieben enthalten. Fehlgeschlagene oder gesperrte Abrufe zählen nicht als erfolgreiche Preisermittlung. Das Prüfprotokoll steht in `scraper/pizza_checks.json`. `scraper/pizza_exclusions.json` enthält ausdrücklich ausgeschlossene Lokale; diese werden auch bei neuen Discovery- und Retry-Läufen nicht wieder veröffentlicht. La Pizza Buona wurde auf Nutzerwunsch aus der Pizzaansicht entfernt.

Verglichen wird eine **ganze, normale Pizza Margherita**. Restaurantkarten liefern Vor-Ort-Preise. Unterstützte öffentliche Online-Speisekarten (u. a. Orderstar, WordPress-Pizzakarten und Bestellkarten mit separaten Grössen) werden ebenfalls ausgelesen und ausdrücklich als **Onlinepreis** gekennzeichnet; daraus wird kein Vor-Ort-Preis abgeleitet. Kinderpizzen, kleine/halbe Portionen, Familienpizzen, separate Spezialvarianten, reine Pinsa-Angebote, bedingte Mittagsangebote sowie Liefer-/Take-away-Sonderpreise werden nicht übernommen. Die Standardgrösse kann je nach Restaurant variieren; eine fehlende Durchmesserangabe wird nicht erfunden. Preisfilter und Sortierung gelten pro Pizza, ohne Getränke- oder Volumenfilter. Die Pizzaansicht startet bei CHF 30; der Preisfilter bleibt je Kategorie erhalten. Einträge und Korrekturen nutzen dieselbe gemeinsame Speicherung wie Getränke.

Der Scraper liest HTML, PDF-Karten, standortbezogene Schema.org-Menülinks und öffentliche Orderstar-Produktdaten. **Bild-PDFs und Menübilder werden lokal mit Tesseract OCR gelesen**, einschliesslich hochauflösender Originalbilder statt Wix-Vorschaubildern. Name und zugehöriger Preis müssen mit ausreichender OCR-Sicherheit erkannt werden; der Quellenlink und ein OCR-Beleg bleiben erhalten. Die Bildverarbeitung wird nach Inhalts-Hash zwischengespeichert. Pro Lokal werden standardmässig bis zu **20 Dokumente statt 6** geprüft, mit Vorrang für Pizza- und Speisekarten. PDF-Zeilenumbrüche, nebeneinander gedruckte Gerichte und Preisfelder vor dem Namen werden unterstützt. Bei Grössenvarianten werden nur normale ganze Pizzen mit 26–35 cm berücksichtigt. Unterschiedliche OSM-Filialseiten derselben Domain werden getrennt geprüft; fremde Filialkarten bleiben ausgeschlossen. Vor-Ort-Karten haben Vorrang vor ausdrücklich gekennzeichneten Onlinepreisen; widersprüchliche Preise innerhalb desselben Kontexts werden zurückgehalten. Eine nicht vorhandene `robots.txt` (4xx ausser 408/429) blockiert öffentliche Dokumente nicht; ausdrückliche Disallow-Regeln, Rate-Limits und Serverfehler werden weiterhin beachtet ([RFC 9309, Abschnitt 2.3.1.3](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3)). `pizza_menu_urls.json` enthält gezielt zugeordnete Originalkarten. Visuell geprüfte Bildkarten, Grössenspalten und mehrdeutige Layouts stehen mit SHA-256-Prüfsumme in `reviewed_pizza_menus.json`; bei einer Änderung werden sie erneut prüfpflichtig. Beispiele: Pizza Züri CHF 17.50 für 1/1 statt CHF 14.50 für 1/2; Il Grappolo CHF 19 für 30 cm statt CHF 14 für die Kinderpizza; Santa Lucia je nach Filialkarte CHF 18 oder CHF 19; Grottino 77 CHF 19 aus der visuell geprüften Bildkarte. Regressionfälle für die erweiterten Auslesewege sind Alba Wiedikon CHF 23 und Alba Triemli/Stampfenbach CHF 20 aus den standorteigenen Schema.org-Menülinks sowie Bella Napoli CHF 17 für 32 cm aus der dynamischen Online-Speisekarte (40 cm für CHF 32 ausgeschlossen). Das Abrufdatum belegt den Quellenabruf und garantiert nicht, dass die Karte selbst neu ist. Es wird keine vollständige Marktabdeckung behauptet.

Für die lokale Bildauslese muss `tesseract` installiert sein (`brew install tesseract` bzw. `sudo apt-get install tesseract-ocr`). Die Prüf- und Scraping-Workflows installieren es automatisch. Zusätzliche OCR-Beispiele: Da Michelangelo CHF 18, Cucina CHF 18, Freihof Etna CHF 15.90, Il Salento CHF 16.50 und Ristorante 99 CHF 16.80. Die neuen Bildbelege wurden zusätzlich visuell kontrolliert.

```bash
# Bekannte Standorte aktualisieren und weitere Zürcher Restaurants prüfen
python -m scraper.scrape_pizza --discover --limit 0 --workers 8 --max-pages 20
# Gezielt einzelne Lokale erneut prüfen
python -m scraper.scrape_pizza --discover --only 'Santa Lucia|Margheri'
# Archivierte Dokumente mit ihrem ursprünglichen Abrufdatum auswerten
python -m scraper.scrape_pizza --venues-file scraper/cache/zurich/pizza-venues.json --archive-dir scraper/cache/zurich/pizza --archive-dir scraper/cache/pizza
```

Der vorhandene dreiwöchentliche Vollscan aktualisiert zusätzlich den Pizza-Datensatz. Der reine KI-Scan bleibt auf seine bisherigen Getränkedaten begrenzt.

### Kaffee

Kaffee ist seit dem 16. Oktober 2026 die Standardkategorie in Zürich, Bern und Basel. Die separate Sorte „Matcha“ wurde entfernt; „Matcha Latte“ bleibt auswählbar. Eine gezielte Nachsuche ergänzt sieben Standorte mit belegtem Matcha-Latte-Preis: Schminkbar und beide Maru-Filialen in Zürich, Café Racer und Queen's Bread in Bern sowie Café Nona und Pförtnerhaus in Basel. Damit enthalten die Datensätze 23, 10 und 9 Standorte mit Matcha Latte (zuvor 20, 8 und 7; vor dem Lokaltypfilter). Originalquellen, Abrufdaten und bei manuell geprüften Karten SHA-256-Prüfsummen sind hinterlegt. Reiner Matcha wird weder neu erfasst noch als Matcha Latte umetikettiert.

`public/data/coffee.json` enthält am **15. Oktober 2026** **880 Kaffeeangebote bei 193 Locations** sowie weitere Cafés ohne belegten Preis: insgesamt **542 Standorte** einschliesslich Plüsch. Die Erweiterung durchsucht aktuelle Originalseiten direkt und wertet vorhandene Dokumente erneut aus. Die Anzahl bezieht sich auf alle Sorten; der aktuelle Sortenfilter zeigt die dazu passenden Preise. Der Kaffee-Scraper prüft neben Bars auch Restaurants und Cafés innerhalb der Zürcher Stadtgrenze. Er übernimmt nur vollständig erkannte Kaffeenamen mit eindeutigem Preis (CHF 2–12). Einfache und doppelte Espressi bleiben getrennt; Caffè latte wird als Milchkaffee klassifiziert. Allgemein als „Kaffee“ bezeichnete Angebote sind mit Café crème gruppiert; der Originalname bleibt sichtbar. Eisgetränke, alkoholische Kaffees, Aufpreise und Kombiangebote werden nicht als Standardkaffee aufgenommen. Fehlende Sorten können als „Preis offen“ angezeigt werden. Die Kaffeeansicht enthält zusätzlich alle gefundenen OSM-Cafés, auch ohne öffentliche Preise. Diese bleiben als „Preis offen“ sichtbar und können von Besuchern ergänzt werden; fehlende Preise werden nicht erfunden. Neue Restaurants werden erst mit belegten Kaffeepreisen aufgenommen. Imbisse (`fast_food`) sind im Kaffee-Tab ausgeschlossen, auch mit Kaffeepreisen oder aktiviertem «Ohne passenden Preis anzeigen». Die Option «Imbiss» entfällt dort im Lokalfilter und Imbisse erscheinen auch nicht als zusätzliche Orte zum Preiseintragen auf der Karte. Beim Wechsel von einer Imbiss-Auswahl zu Kaffee wird der Lokalfilter auf «Alle» gesetzt. Bars und Pubs bleiben enthalten. Bars und Pubs bilden in allen Kategorien eine gemeinsame Lokalauswahl «Bar / Pub».

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

Die gezielte Kaffee-Nachsuche vom 15. Oktober ergänzt **89 Angebote bei 20 weiteren Locations**. Unter den 391 Cafés haben nun **44 statt 38** mindestens einen Kaffeepreis, davon **27 statt 24** einen Café-crème-/Kaffeepreis. Neue Café-Treffer sind Ahoi!, Babu’s an der Theaterstrasse, Glückbar Café, Kafi Mühli, Klara’s Kitchen und Mont Martre. Die Quellen bleiben beim jeweiligen Angebot verlinkt; ein Abrufdatum macht eine ältere Menükarte nicht automatisch aktuell.

Der Kaffee-Crawler folgt auch Café-/Bistro-/Restaurant-Unterseiten und priorisiert Getränkekarten anhand von Linktext und URL vor Shops, Weinlisten und anderen Dokumenten. Hochgestellte Rappen mit abweichender PDF-Schriftkodierung werden anhand der Zeichenpositionen gelesen; gewöhnliche dreistellige Zahlen bleiben ausgeschlossen. Sitzungskarten und bekannte Karten anderer Standorte werden nicht übernommen. Der KI-Scan berücksichtigt zusätzlich verzögert geladene Menübilder in `data-src`; hierfür wurde bei dieser Nachsuche kein kostenpflichtiger KI-Lauf gestartet.

Begrenzte Kaffee-Läufe aktualisieren bekannte Preise und prüfen zusätzlich höchstens `--limit` noch preislose Locations, zuerst Cafés und darin die am längsten nicht geprüften Quellen. Das Limit gilt auch für bereits auf der Karte sichtbare Cafés ohne Preise. Gezielte Nachsuche und Quellenarchiv:

```bash
python -m scraper.scrape_coffee --missing-only --limit 50 --workers 8 --audit-dir /tmp/coffee-audit
python -m scraper.scrape_coffee --only 'Mont Martre|Babu' --max-pages 10
```

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
- **Refresh city prices:** alle drei Wochen montags um 04:23 UTC (ab 19. Oktober 2026) und jederzeit manuell unter Actions. Aktualisiert Standorte und bekannte Preise, prüft danach alle eindeutig zuordenbaren Gastronomie-Websites für Bier und Kaffee mit bis zu zehn Dokumenten pro Kandidat. Kaffee und zusätzliche Bier-Locations verwenden maximal acht parallele Abrufe; robots.txt, Pausen und Grössenlimits gelten weiterhin. Der Lauf committet Bier-, Kaffee-, Pizza- und Standortdaten samt Prüfstand für alle drei Städte und hat ein Limit von 180 Minuten pro Stadt. Benötigt die im Workflow deklarierte Schreibberechtigung für Repository-Inhalte. Private Repositories verwenden das Actions-Kontingent des Accounts.
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
.github/workflows/          CI, Dreiwochenimport, optionales Deployment
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

`public/data/locations.json` ergänzt einen separaten Katalog von **2’192 OSM-Lokalen** für Kartenauswahl und serverseitige Prüfung. Er enthält keine Preise und füllt die Preislisten nicht mit zusätzlichen leeren Lokalen. Name, Koordinaten und OSM-ID kommen aus diesem Katalog bzw. den bestehenden Datensätzen; der Server akzeptiert keine frei übermittelten Standortangaben. Mit einem Preiseintrag wird eine Standortkopie gespeichert, sodass das neue Lokal auch nach dem Neuladen oder einer späteren Katalogänderung erhalten bleibt. Bestehende Einträge ohne Standortkopie bleiben kompatibel.

`python -m scraper.locations` aktualisiert den Katalog innerhalb der Zürcher Stadtgrenze ohne Menüabrufe; der vollständige Refresh-Workflow führt diesen Schritt ebenfalls aus und veröffentlicht die Datei zusammen mit den Preisen. Der Erstbestand verwendet den vorhandenen OSM-Import vom 15. Oktober 2026. Noch nicht im Katalog enthaltene oder umbenannte OSM-Orte stehen nach einem späteren Import zur Verfügung. Kartenbeschriftungen und OSM-Daten können zeitlich voneinander abweichen.

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

Das Repository-Secret `ANTHROPIC_API_KEY` wird ausschliesslich dem KI-Scan-Schritt übergeben. Es gehört weder in den Browser noch in Vercel oder die Daten-Dateien. `Refresh city prices` aktualisiert Bier und Kaffee **alle drei Wochen montags um 04:23 UTC**, beginnend am **19. Oktober 2026**, und führt nach der normalen Suche den Claude-Scan aus. Der wöchentliche Zeitplan führt den Scan nur jeden dritten Montag in einem festen 21-Tage-Rhythmus aus, auch über Jahreswechsel hinweg. Manuelle Läufe sind jederzeit möglich; auswählbar sind `full`, `ai_only`, `estimates_only` und `photos_only`.

`python -m scraper.ai_scan --discover` sucht zusätzliche Zürcher Restaurants/Cafés, folgt Menülinks und liest HTML, PDF-Seiten samt Bildern sowie direkt verlinkte Menübilder. Derselbe Aufruf sammelt Bier und Kaffee. Ausschliesslich Claude Haiku 5.5 (`claude-haiku-5-5`) liefert strukturierte Ergebnisse; Mengen, Preise, Quellenzuordnung und Preisbelege werden zusätzlich validiert. Bestehende widersprechende Preise werden nicht automatisch ersetzt. Neue KI-Preise tragen «KI-erkannt · nicht geprüft», Quellenlink, Abrufdatum, Dokument-Hash und gegebenenfalls PDF-Seite. KI-Erkennung kann dennoch fehlerhaft sein.

Unbekannte Ausschankarten erhalten `beerTypeEstimate` (Typ, konkrete Begründung, Methode), während `beerType` unverändert bleibt. Der KI-Scan übergibt bei HTML-Menüs zusätzlich bis zu zwölf eindeutig einer bepreisten Bierzeile zugeordnete Produktbilder (höchstens 6 MB insgesamt). Bildgestützte Schätzungen speichern `sourceImage` und haben Vorrang vor Mengen-Heuristiken; Nachbarprodukte, mehrdeutige Bildzuordnungen und fehlgeschlagene Bildabrufe dürfen keinen Bildnachweis liefern. Preis, Menge und Alternativen dienen als zusätzliche Hinweise, ein einzelnes günstiges 5-dl-Bier belegt kein Offenbier. Die konkrete KI-Begründung bleibt erhalten. Preise und Mengen werden nicht geschätzt. Biermischgetränke (Panaché/Panash, Henaché, Radler, Shandy usw.) sind vom Biervergleich ausgeschlossen, auch unter einer Offenbier-Überschrift. Gemischte Angebotszeilen wie „Lager / Panaché“ werden vorsichtshalber ebenfalls ausgelassen. Der Ausschluss gilt für Extraktion, geprüfte Menüs, bestehende Daten, Besucherbeiträge und Anzeige. Offenbier-Schätzungen brauchen eine konkrete Ausschankangabe, eine benannte Bierportion oder passende Grössen desselben Biers auf derselben Karte ohne widersprechenden Verpackungsbeleg. Unbelegte KI-Offenbier-Schätzungen werden bei der Aktualisierung entfernt. Häufigkeiten einer Portionsgrösse in anderen Lokalen rechtfertigen keine Ausschank-Schätzung. Besucherkorrekturen haben Vorrang, ihre Angebotsschlüssel hängen nicht an einer Schätzung.

Standardbudget und feste Obergrenze pro Lauf: **1.00 USD API-Tokenkosten**, gemeinsam für alle KI-Schritte; im Workflow wird dieses Gesamtbudget auf Zürich, Bern und Basel verteilt. Dies gilt für geplante und manuelle Läufe in allen Scan-Modi. Über `ai_budget_usd` bzw. `--budget-usd` kann ein kleineres Budget gewählt werden; höhere Eingaben werden auf 1.00 USD gedeckelt. Nur **Haiku 5.5**, kein anderes Modell und kein Fallback. Weitere Grenzen: 1000 Generierungen, 8 Dokumente pro Lokal, 60 Minuten KI-Menüsuche im Workflow. Vor jeder Generierung werden Tokens gezählt und maximale Kosten unter einem gemeinsamen Lock reserviert. Fehlgeschlagene Requests behalten ihre Reservierung; Generierungen werden nicht automatisch wiederholt. Prompts über 100’000 Tokens werden abgelehnt. Preisbasis: [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview), 0.10 USD / Mio. Eingabe- und 0.50 USD / Mio. Ausgabetokens bis 100’000 Eingabetokens, ohne Steuern. Die Reservierung verwendet vorsichtshalber sogar den höheren Tarif (0.50 / 2.50 USD) plus Tokenpuffer. Historische Quellen behalten ihre damalige Modellangabe. Öffentliche Quellen und Extrakte werden an Anthropic gesendet; keine Besucher- oder Community-Daten. Der Anbieter-Schlüssel wird nur an `api.anthropic.com` gesendet.

Textreiche PDF-Abschnitte ohne Hinweise auf Bier, Kaffee oder passende Portionsgrössen werden übersprungen; Seiten ohne brauchbaren Text gehen an die Bilderkennung. Identische Dokumente werden pro Lokal nur einmal verarbeitet. Cafés ohne Kaffeepreise werden zuerst geprüft. Ein Inhalts-Cache verhindert erneute API-Kosten für identische Dokumente/Prompts. `scraper/ai_checks.json` lässt spätere Läufe zu noch nicht geprüften Lokalen weitergehen. Ein Bericht mit Kosten, Treffern und Fehlern steht im Actions-Lauf und als Artefakt. Bei fehlendem Schlüssel bleibt der normale Scraper verwendbar; bei API-/Netzwerkfehlern werden vorhandene Angebote erhalten. Robots-Regeln und bestehende Filial-/Quellenbeschränkungen gelten weiterhin.

Beim Veröffentlichen wird der Scan auf den neuesten Branch-Stand angewendet, ohne JSON-Dateien per Git-Rebase zusammenzuführen. Lokale und Prüfprotokolle werden anhand ihrer Lokal-ID abgeglichen: Hat sich derselbe Datensatz seit Scanbeginn auf dem Branch geändert oder wurde er gelöscht, bleibt die Branch-Version erhalten. Die übrigen Scan-Ergebnisse werden übernommen. Bei einem zwischenzeitlichen Push wird die Zusammenführung bis zu dreimal frisch versucht, ohne Force-Push. Das Actions-Artefakt `refreshed-dataset` sichert vor dem Veröffentlichen den Ausgangsstand und sämtliche erzeugten Daten. Es erlaubt einen erneuten Veröffentlichungsversuch ohne erneutes Scraping: `python -m scraper.publish --snapshot /pfad/refresh-snapshot.json --branch main`.

## Datierte Google-Maps-Menüfotos

Der OCR-Scan verarbeitet zusätzlich die einzeln geprüften Quellen in `scraper/menu_photos.json`. Er nutzt denselben Haiku-5.5-Client und **dasselbe gemeinsame Laufbudget (standardmässig und maximal 1.00 USD)** wie die übrige KI-Suche. `photos_only` in Actions bzw. `python -m scraper.ai_scan --photos-only` prüft nur diese Fotos.

Die Suche und Datumsprüfung in Google Maps sind derzeit **manuell**, die anschliessende OCR und Übernahme laufen automatisch. Die [offizielle Photo-API](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#Photo) bietet kein Foto-Datumsfeld; sie kann die Sechsmonatsgrenze nicht allein belegen. Dies ist kein flächendeckender Google-Maps-Crawler. Nur am einzelnen Foto geprüfte Datumsangaben zählen, niemals das Datum einer Rezension, das Abrufdatum oder ein vom Modell geratenes Datum. Stimmen Aufnahme- und Veröffentlichungsangabe nicht überein, ist die ältere Angabe massgeblich.

Pro Quelle: OSM-`barId`, direkter Maps-Fotolink, beobachtete `imageUrl`, `photoDate` (`YYYY-MM-DD` oder `YYYY-MM`), `dateEvidence`, `dateCheckedAt`, `venueConfirmed: true`, `isMenu: true`. Die Zuordnung wird am Lokalnamen und Standort geprüft. Bei Monatsangaben zählt vorsichtshalber der Monatserste: am 15.10.2026 ist ein Foto vom 15.04.2026 zulässig, ein nur mit „April 2026“ datiertes Foto hingegen nicht. Fehlende, zukünftige und zu alte Datierungen werden **vor** dem Bildabruf und jeder API-Anfrage verworfen.

Wenn ein direkter automatischer Bildabruf durch robots.txt ausgeschlossen ist, kann ein einzeln im Browser ausgewähltes Foto als `imagePath` unter `scraper/photo_inputs/` mit passender `sha256` importiert werden. Diese Dateien sind von Vercel ausgeschlossen und werden nicht auf der Website gespiegelt. Quellen dürfen keine Zugangssperren umgehen. Der erste importierte Beleg ist die vom Lokal veröffentlichte Kaffeekarte von 169 West, datiert September 2026.

OCR-Preise behalten den Fotolink, das Fotodatum, den Textbeleg und das separate Lesedatum. Unlesbare Ziffern, Strichlisten, Spenden, rückseitig durchscheinender Text und unklare Portionsgrössen werden nicht als Preise übernommen. Bestehende widersprechende Preise werden nicht automatisch ersetzt. Abgelaufene Fotoangebote verschwinden aus dem Kartenvergleich und der Detailansicht auch ohne neuen Scan; der nächste Scan entfernt sie aus dem Datensatz. Ein neuer Besucherpreis bleibt unabhängig davon erhalten.

Im Biervergleich erscheinen Cafés nur mit einem aktuellen, vergleichbaren Bierangebot im Datensatz (einschliesslich Besucherbeiträgen). Cafés, deren hinterlegte Öffnungszeiten an keinem Tag über 19 Uhr hinausreichen, werden auch mit Bierpreisen ausgeblendet. Unbekannte Öffnungszeiten allein führen nicht zum Ausschluss. Diese Vorauswahl gilt für Liste, Karte und ausgewählte Lokale unabhängig von «Ohne passenden Preis anzeigen»; Kaffee und Pizza sind davon ausgenommen.
