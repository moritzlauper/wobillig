# wobillig

wobillig ist eine Karte, auf der du Kaffee-, Bier- und Pizzapreise in Zürich, Bern, Basel, Winterthur, Lausanne und Genf vergleichst. Die Website läuft unter **[wobillig.ch](https://wobillig.ch)**. Sie ist kostenlos und funktioniert ohne Konto.

Die Preise stammen aus öffentlich zugänglichen Speise- und Getränkekarten der Lokale und aus Einträgen von Besucherinnen und Besuchern. Jedes Angebot nennt seine Quelle und das Erfassungsdatum. Ein Scraper liest die Karten alle drei Wochen neu ein. Fehlende Preise werden nie geschätzt.

## Funktionen

- Kaffee ist die Startansicht. Verglichen wird pro Getränk und Sorte, zum Beispiel Espresso, Cappuccino, Café crème, Flat White oder Matcha Latte, ohne Umrechnung auf eine Tassengrösse.
- Bier lässt sich nach Grösse (Stange/3 dl, 3.3 dl, 5 dl), Ausschank (Offen-, Flaschen- oder Dosenbier) und Marke filtern. Auf Wunsch rechnet die Karte auf 5 dl um.
- Pizza erscheint in einer Stadt ab 14 Lokalen mit aktuellem Pizzapreis, gezählt wird jede Sorte. Voreingestellt ist die Margherita, weitere Klassiker wie Diavola oder Quattro Stagioni sind über eine eigene Auswahl erreichbar.
- Burger erscheint in einer Stadt ab 5 Lokalen mit aktuellem Burgerpreis. Voreingestellt sind alle Burger, zur Auswahl stehen ausserdem Vegi Burger (inklusive vegane), Vegan und Glutenfrei. Der Scraper liest Speisekarten von Lokalen mit Burger im Namen oder Küchentyp und bestätigt die Preise mit Claude Haiku 5.5. Vegi und Glutenfrei gelten nur, wenn die Karte es ausweist.
- Softdrinks und Cocktails erscheinen ab 5 Lokalen mit aktuellem Preis, gescannt werden Zürich, Basel und Bern. Die Preise stammen aus dem Gastro-Scan (`scraper/gastro.py`), der die Websites von Restaurants und Bars liest und die Preise mit Claude Haiku 5.5 bestätigt. Pro Lauf und Kategorie stehen in Zürich 3 USD zur Verfügung, in Basel und Bern je 1.50 USD. Softdrinks werden nach Grösse verglichen, voreingestellt sind 3 und 3.3 dl. In Zürich steht Softdrinks direkt in der Kategorienreihe. «Günstig» zeigt bei Softdrinks das günstigste Fünftel statt des günstigsten Drittels, weil sich die Preise bei CHF 5 häufen. Bei Cocktails stehen neben allen Cocktails die Klassiker zur Auswahl, die mindestens drei Lokale führen. Die Brotpreise aus demselben Scan werden noch nicht angezeigt.
- Glutenfrei lässt sich bei Pizza und Bier filtern. Eine Pizza gilt als glutenfrei, wenn die Karte es ausweist oder das Lokal auf seiner Website als glutenfreie Pizzeria auftritt. Ein Bier gilt als glutenfrei, wenn der Name es sagt.
- Preise lassen sich von Hand eintragen und korrigieren oder per Foto der Karte erfassen. Der Foto-Scan liest die Preise mit Claude Haiku 5.5 aus und speichert sie direkt beim gewählten Lokal. Das Bild selbst wird nicht gespeichert.
- Fehlende Lokale können ergänzt und bestehende korrigiert werden (Name, Adresse, Website).
- Kaffee lässt sich mit Sternen und einem Foto bewerten. Der Durchschnitt erscheint ab drei Stimmen.
- Über das Plus neben den Kategorien entstehen eigene Maps, etwa für Brot oder Haferflocken. Wer den Link hat, kann eine Map ansehen und bearbeiten. Nach einer Prüfung kann sie öffentlich unter «Weitere» erscheinen. Automatische Maps lassen sich bereits anfragen, ein Import dafür ist aber noch nicht aktiv.
- Unter «Filter» stehen die Zürcher und Winterthurer Stadtkreise, die Basler Wohnviertel, die Berner Stadtteile und die Quartiere von Lausanne und Genf zur Auswahl, jeweils mit eigenem Durchschnittspreis.
- Das Fenster «Daten» exportiert den Bestand der Stadt als CSV oder JSON.
- Lokale lassen sich per Link teilen. Es gibt einen Hell- und einen Dunkelmodus sowie eine deutsche und eine englische Oberfläche.
- «Plattformkosten stützen» ist ein freiwilliger Beitrag an Hosting, Speicher und KI-Scan, bezahlt per TWINT oder Karte über Stripe. Der Betrag entspricht einem günstigen Cappuccino der Stadt, aktuell CHF 5.50 in Zürich und Basel, CHF 5.40 in Winterthur, CHF 5.20 in Bern und CHF 4.90 in Lausanne und Genf.

### Günstig-Filter

Neue Aufrufe ohne konkrete Filter starten mit «Günstig». Ein Klick auf das ✕ im aktiven Günstig-Button hebt den Filter auf. Die Wahl bleibt im Browser gespeichert. Ist «Günstig» aktiv und sonst nichts gewählt, bleibt die Adresse ohne Zusatz, also `wobillig.ch` oder `wobillig.ch/bern`. Wer einen solchen Link öffnet und den Filter früher aufgehoben hat, sieht weiterhin alle Lokale. In allen anderen Fällen enthalten geteilte Links die Wahl als `cheap=1` oder `cheap=0`.

Die Grenze von «Günstig» richtet sich nach den Lokalen mit Preis in der aktuellen Auswahl, also nach Kategorie, Sorte, Grösse, Suche und Quartier. Angezeigt wird das günstigste Drittel, mindestens aber zehn Lokale. Bei weniger als 20 Lokalen ist es die günstigere Hälfte. Lokale mit genau dem Grenzpreis kommen alle dazu. Teilen sich viele Lokale diesen Preis, gilt die nächsttiefere Preisstufe, sofern ihre Anzahl relativ mindestens so nah am Ziel liegt oder sonst alle Lokale angezeigt würden. Ausserdem liegt die Grenze mindestens 3% unter dem Durchschnitt der Auswahl, solange dabei die genannte Mindestzahl an Lokalen übrig bleibt. Für Pizza Margherita liegt die Grenze bei mindestens CHF 18.

Das Feld «Bis CHF» zeigt ohne eigene Eingabe den höchsten Preis der passenden Liste. Eine eigene Grenze bleibt bei weiteren Filteränderungen und in geteilten Links erhalten.

## Städte und Seiten

| Stadt | Deutsch | Englisch |
| --- | --- | --- |
| Zürich | `/` | `/en` |
| Bern | `/bern` | `/en/bern` |
| Basel | `/basel` | `/en/basel` |
| Winterthur | `/winterthur` | `/en/winterthur` |
| Olten | `/olten` | `/en/olten` |
| Lausanne | `/de/lausanne` | `/en/lausanne` |
| Genf | `/de/geneve` | `/en/geneve` |

Lausanne und Genf öffnen standardmässig auf Englisch. `/lausanne` und `/geneve` leiten dorthin weiter, ebenso ältere `/genf`-Links. Genf umfasst neben der Stadt 15 Nachbargemeinden wie Carouge, Lancy und Vernier, französische Gemeinden gehören nicht dazu.

Zu jeder Stadt gibt es vier Ranglisten, die auch ohne JavaScript lesbar sind: `/espresso-<stadt>`, `/cappuccino-<stadt>`, `/stange-<stadt>` und `/margherita-<stadt>` mit den Kürzeln `zuerich`, `bern`, `basel`, `winterthur`, `olten`, `lausanne` und `genf`, auf Englisch mit vorangestelltem `/en`. Sie zeigen die 25 günstigsten erfassten Lokale mit Quelle und Datum. Die Stangen-Liste zählt nur Offenbier, die Margherita-Liste nur Restaurants ohne Imbisse und Takeaways. Zusammen mit den Stadtseiten stehen 70 Seiten in der Sitemap.

## Datenstand

Datensätze vom 19. bis 21. Oktober 2026, für Winterthur vom 26. Oktober 2026, ohne Community-Einträge:

| Stadt | Kaffee: Lokale / Angebote | Bier: Lokale / Angebote | Pizza: Lokale mit Margherita-Preis | Lokale im OSM-Katalog |
| --- | ---: | ---: | ---: | ---: |
| Zürich | 300 / 1'539 | 312 / 2'402 | 83 | 2'198 |
| Bern | 132 / 730 | 127 / 981 | 23 | 715 |
| Basel | 90 / 467 | 84 / 760 | 19 | 784 |
| Winterthur | 56 / 291 | 56 / 432 | 14 | 388 |
| Lausanne | 59 / 252 | 57 / 521 | 10 | 630 |
| Genf | 74 / 284 | 73 / 426 | 16 | 1'561 |

Mit den Scraper-Daten allein erreichen alle Städte ausser Lausanne (10 Lokale) die Schwelle von 14 Pizza-Lokalen. Für Döner und Falafel gibt es Datensätze, die Kategorien erscheinen aber erst ab 50 Dürüm-Angeboten pro Stadt und sind derzeit überall ausgeblendet.

Vollständig ist die Karte nicht. Viele Lokale veröffentlichen keine maschinenlesbare Karte, und OpenStreetMap kennt nicht jedes Lokal. Das Erfassungsdatum sagt, wann eine Quelle gelesen wurde, nicht, wie alt die Karte selbst ist.

## Woher die Preise kommen

Die Standorte kommen aus OpenStreetMap, abgefragt über Overpass (`overpass.osm.ch`, Ersatz `overpass-api.de`) innerhalb der jeweiligen Stadtgrenze. Geprüfte Ergänzungen stehen in `scraper/additional_venues.json` und `scraper/verified_coffee_venues.json`.

Der Python-Scraper folgt der Website eines Lokals und liest HTML-Seiten, PDF-Karten und mit Tesseract-OCR auch Bildkarten. Er hält sich an `robots.txt` und Crawl-Delay, wartet pro Host mindestens eine Sekunde und umgeht keine Logins, Captchas oder Sperren. Übernommen wird ein Preis nur, wenn Produkt, Menge und Preis eindeutig zusammengehören. Karten, die nur visuell eindeutig sind, liegen geprüft mit SHA-256-Prüfsumme in `scraper/reviewed_*.json` und gelten nur, solange sich die Datei nicht ändert.

Was der Parser nicht lesen kann, etwa gescannte PDF-Seiten oder Menübilder, geht an Claude Haiku 5.5. Das Budget dafür liegt bei 4 USD pro Stadt und Lauf. Solche Preise sind als «KI-erkannt» markiert. Einträge von Besucherinnen und Besuchern haben Vorrang vor Scraper-Preisen, ausser eine nachweislich neuere Karte nennt für dasselbe Produkt einen anderen Preis.

## Lokal entwickeln

Voraussetzungen: Node.js 22.12 oder neuer und Python 3.12 oder neuer.

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
```

Ohne Servervariablen läuft die Karte mit den eingecheckten Daten, Speichern ist dann deaktiviert. Mit `vercel env pull .env.local` und `vercel dev` läuft die API lokal gegen den Entwicklungsspeicher.

```sh
npm test                                          # Vitest: Datenlogik, API, SEO, Sicherheit
npm run build                                     # Typprüfung und Produktionsbuild
npx playwright install chromium && npm run test:browser
python -m unittest discover -s tests -p 'test_*.py'
```

`npm run test:ocr` (echte, kostenpflichtige Erkennung) und `npm run test:storage` (temporäre Objekte im echten Blob-Speicher, danach gelöscht) laufen nur auf ausdrücklichen Aufruf und brauchen `.env.local`.

## Scraper

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r scraper/requirements.txt           # zusätzlich: brew install tesseract

python -m scraper.scrape --discover               # Standorte aus OSM, Bierpreise
python -m scraper.scrape_coffee --discover --limit 0
python -m scraper.scrape_pizza --discover --limit 0
python -m scraper.locations                       # nur Standortkatalog
python -m scraper.ai_scan --discover              # KI-Scan, braucht ANTHROPIC_API_KEY
python -m scraper.burger --budget-usd 2           # Burger-Karten Zürich, KI-Bestätigung
```

`WOBILLIG_CITY=bern`, `basel`, `winterthur`, `olten`, `lausanne` oder `geneva` wählt die Stadt, ohne Variable gilt Zürich. Einzelne Lokale prüft `--name 'Bar Rossi'` beim Bier und `--only 'Name|Name'` bei Kaffee und Pizza. `--max-pages` begrenzt die Dokumente pro Lokal, `--limit` die Zahl neuer Kandidaten.

| Datei | Zweck |
| --- | --- |
| `scraper/menu_urls.json`, `coffee_menu_urls.json`, `pizza_menu_urls.json` | Zusätzliche Menülinks pro OSM-ID |
| `scraper/reviewed_menus.json`, `reviewed_coffee_menus.json`, `reviewed_pizza_menus.json` | Visuell geprüfte Karten mit Prüfsumme |
| `scraper/source_scopes.json`, `coffee_source_scopes.json` | Grenzt Karten anderer Filialen und Archivkarten aus |
| `scraper/website_overrides.json` | Geprüfte Websites, wenn OSM keine oder eine falsche nennt |
| `scraper/venue_type_overrides.json` | Korrigierte Lokaltypen |
| `scraper/pizza_exclusions.json` | Dauerhaft ausgeschlossene Pizza-Lokale |
| `scraper/menu_photos.json` | Einzeln geprüfte, datierte Menüfotos |
| `scraper/cities/<stadt>/` | Prüfprotokolle pro Stadt, Zürich liegt im Stammordner |

### Privater Aktionspilot

Die Prüfseite verlinkt eine private Aktionskarte für Zürich (`/api/deals?view=preview`, nur mit Prüfzugang). Sie zeigt die Titelseite des Coop-Prospekts, die der Workflow täglich einliest, und die Weinaktionen von coop.ch mit der Verfügbarkeit in den Filialen der Stadt Zürich. coop.ch blockiert automatisierte Abrufe. Aktionsliste und Filialsuche werden deshalb manuell in einem normalen Browser gelesen, mit dem Crawl-Delay von 5 Sekunden aus der robots.txt. Den Export wandelt man so um und speichert ihn:

```sh
python -m scraper.coop_wine output/deals/coop-wine-raw.json
node --env-file=.env.local scripts/deals-import.mjs --sweep output/deals/coop-wine.json --production
```

Übernommen werden nur Angebote mit gedrucktem Statt-Preis. Steht derselbe Preis im aktuellen Prospekt, gilt dessen Gültigkeit. Sonst nennt coop.ch kein Enddatum, und das Angebot verschwindet zwei Tage nach dem Abruf. Die Verfügbarkeit pro Filiale stammt aus der coop.ch-Filialsuche und gilt ohne Gewähr. Der Sweep liegt neben dem Prospektimport und wird von diesem nicht überschrieben.

## Aufbau

```text
src/           Oberfläche (TypeScript, Leaflet), Filter- und Preislogik, Übersetzungen
server/        Speicher, Limits, Moderation, Foto-Scan, Zahlungen
api/           Vercel-Funktionen, etwa /api/prices, /api/scan-menu, /api/tip
build/         Statische SEO-Seiten, Impressum und Datenschutz
public/data/   Veröffentlichte Datensätze, Zürich im Stammordner, sonst pro Stadt
scraper/       Python-Scraper, Prüflisten und Overrides
scripts/       Backups, Health-Check, Quartiergrenzen, Teaserbild
tests/         Vitest (*.test.ts), Playwright (*.browser.ts), Python (test_*.py)
```

Neue Oberflächentexte stehen auf Deutsch in `t('…')` und brauchen einen Eintrag in `src/i18n-en.ts`. `tests/i18n.test.ts` schlägt sonst fehl.

## Betrieb

Das Vercel-Projekt `wobillig` ist mit diesem Repository verbunden. Jeder Push auf `main` geht direkt in Production, auch die Daten-Commits des Scrapers. Hauptdomain ist `wobillig.ch`, `www.wobillig.ch` leitet dorthin weiter. Canonical-URLs, hreflang, Sitemap und `robots.txt` verwenden deshalb `https://wobillig.ch` (`siteOrigin` in `src/seo.ts`, beim Build per `SITE_URL` überschreibbar). Wer die Hauptdomain oder die Weiterleitung in Vercel ändert, muss `siteOrigin` anpassen. Cookies und Browserspeicher gelten nur für den jeweiligen Hostnamen.

Community-Daten liegen in einem privaten Vercel-Blob-Store, getrennt nach Stadt und nach Production und Entwicklung. Der Browser bekommt nie einen Blob-Token. IP-Adressen und Browserkennungen werden nur als HMAC gespeichert. Gültige Beiträge erscheinen nach automatischen Prüfungen ohne manuelle Freigabe, wegen Server- und CDN-Cache mit bis zu zwei Minuten Verzögerung. Auffällige Preisänderungen werden zurückgehalten. Die Prüfseiten für zurückgehaltene Beiträge und eingereichte Maps sind passwortgeschützt. Neue Anfragen für automatische Maps und Einreichungen zur Veröffentlichung meldet der Server per E-Mail an hello@wobillig.ch, höchstens 50 pro Tag. Ohne SMTP-Variablen entfällt die E-Mail, die Prüfseite listet die Anfragen trotzdem.

Stand 22. Oktober 2026 in Production: Cloudflare Turnstile prüft jeden Beitrag, die manuelle Freigabe ist aus, die Konto-Schaltflächen sind ausgeblendet und eine E-Mail-Bestätigung ist nicht nötig.

### Umgebungsvariablen

Alle Werte sind Servervariablen und bekommen nie ein `VITE_`-Präfix. Die Vorlage steht in `.env.example`. Nach einer Änderung in Vercel braucht es ein neues Deployment.

| Variable | Zweck |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Privater Speicher für Beiträge, Limits und Backups |
| `ANTHROPIC_API_KEY` | Foto-Scan für Menükarten, als GitHub-Secret auch für den KI-Scan |
| `GOOGLE_PLACES_API_KEY` | Google-Bewertungen für Pizzerien, höchstens 1'000 Anfragen pro Monat |
| `TRIPADVISOR_API_KEY` | Tripadvisor-Bewertungen für Pizzerien, sobald das Google-Kontingent des Monats aufgebraucht ist. Höchstens 1'000 Einheiten insgesamt, damit nichts kostet |
| `MAP_REVIEW_PASSWORD` | Zugang zu den Prüfseiten |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Beitrag an die Plattformkosten. Ohne Live-Schlüssel bleibt der Button in Production ausgeblendet |
| `CONTRIBUTION_PROTECTION`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Bot-Schutz vor Beiträgen |
| `COMMUNITY_PHOTO_DAILY_USD`, `COMMUNITY_PHOTO_DAILY_LIMIT`, `COMMUNITY_PHOTO_HOURLY_LIMIT` | Gemeinsames Budget aller Foto-Prüfungen (Standard USD 2 pro 24 Stunden) |
| `COMMUNITY_REVIEW_REQUIRED` | `true` hält alle Beiträge bis zur manuellen Freigabe zurück |
| `COMMUNITY_WRITES_PAUSED`, `COMMUNITY_PHOTOS_PAUSED` | Notschalter, siehe unten |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `COMMUNITY_EMAIL_FROM`, `COMMUNITY_EMAIL_DAILY_LIMIT` | Versand der Bestätigungscodes und der Hinweise auf neue Map-Anfragen über Infomaniak |
| `EMAIL_VERIFICATION_REQUIRED`, `COMMUNITY_AUTH_SECRET` | Pflicht-Bestätigung und Signatur der Konto-Sessions |
| `PHOTON_URL`, `SITE_URL` | Optional: eigener Photon-Endpunkt, abweichende Domain |

### Notfall

Bei missbräuchlichen Beiträgen `COMMUNITY_WRITES_PAUSED=true` setzen und neu deployen. Die Karte bleibt lesbar, Beiträge sind pausiert. Betrifft das Problem nur Fotos, reicht `COMMUNITY_PHOTOS_PAUSED=true`. Einzelne Beiträge lassen sich auf der Prüfseite zurücknehmen. Vor jeder Datenreparatur einen Snapshot ziehen:

```sh
node --env-file=.env.local scripts/community-backup.mjs
```

Snapshots nie blind zurückspielen. Beiträge, die nach dem Snapshot eingegangen sind, gingen sonst verloren.

### GitHub Actions

| Workflow | Zeitplan | Zweck |
| --- | --- | --- |
| Checks | Push und Pull Request | Vitest, Build, Playwright und Python-Tests |
| Refresh city prices | alle 21 Tage montags 04:23 UTC, nächste Läufe 9. und 30. November 2026 | Preise aller Städte neu einlesen und auf `main` committen |
| Production health | zweimal pro Stunde | Startseite, Rechtsseiten, Bot-Schutz und öffentliche APIs aller Städte prüfen, nur lesend |
| Private community backup | alle 6 Stunden | Community-Daten im privaten Blob sichern (32 rotierende Stände, rund acht Tage) und die Prüfwarteschlange kontrollieren |
| Refresh private promotion pilot | täglich | Privater Aktionspilot mit dem Coop-Prospekt, nur auf der Prüfseite sichtbar |
| Deploy to GitHub Pages | manuell | Optionale statische Kopie ohne API |

Der Preis-Refresh arbeitet die Städte nacheinander ab (Zürich, Basel, Bern, Lausanne, Genf, Winterthur, Olten), jeweils in drei Abschnitten für Getränke, Pizza und KI. Ein Fehler in einer Stadt hält die anderen nicht auf. Manuell lassen sich `city`, `scan_mode` (`full`, `pizza_only`, `ai_only`, `estimates_only`, `photos_only`), `ai_budget_usd` (Standard 5, höchstens 20 pro Stadt), `deep_scan` und `exhaustive_scan` wählen. Scheitert die Veröffentlichung eines Abschnitts, enthält das Artefakt `refreshed-dataset-…` den Stand, und `python -m scraper.publish --snapshot <datei> --branch main` veröffentlicht ihn ohne neuen Scan.

Die Workflows brauchen die Repository-Secrets `ANTHROPIC_API_KEY` und `BLOB_READ_WRITE_TOKEN`. Solange das Repository öffentlich ist, kosten die Actions-Minuten nichts. Ein einzelner Refresh läuft rund acht Stunden, privat würde das Freikontingent von GitHub schnell aufgebraucht.

## Suchmaschinen

Damit Google `wobillig.ch` als Hauptadresse führt:

1. In der [Google Search Console](https://search.google.com/search-console) eine Domain-Property für `wobillig.ch` anlegen. Die DNS-Bestätigung deckt `www` mit ab.
2. Die Sitemap `https://wobillig.ch/sitemap.xml` einreichen.
3. `https://wobillig.ch/` mit der URL-Prüfung zur Indexierung anmelden.

Jede Seite liefert Titel, Beschreibung, Canonical, hreflang und strukturierte Daten (`WebSite` mit dem Namen «wobillig», `CollectionPage`). Impressum und Datenschutz sind auf `noindex` gesetzt.

## Recht und Datenschutz

`/impressum`, `/datenschutz`, `/en/imprint` und `/en/privacy` entstehen beim Build aus `build/legal-pages.ts`. Die veröffentlichten Betreiberangaben stehen in `build/legal-operator.ts`. Fehlt dort der Name, bricht der Production-Build ab.

Wer einen Dienst, ein Cookie, einen Datenempfänger, ein Analyse-Ereignis oder eine Speicherfrist ändert, passt die Datenschutzerklärung in beiden Sprachen an und setzt das Datum «Stand» neu. Die Erklärung ersetzt keine rechtliche Prüfung.

Für Statistiken laufen Vercel Web Analytics und GoatCounter, beide ohne Cookies. Die eigenen Ereignisse in `src/analytics.ts` übermitteln nur Kategorie, Stadt, Sprache und das Ergebnis einer Aktion, keine Formularinhalte, Lokalnamen, Suchbegriffe oder Koordinaten.

## Quellen und Lizenzen

Der Code steht unter der MIT-Lizenz (`LICENSE`). Rechte an Quelldaten und fremden Inhalten bleiben davon getrennt.

- Standorte: [© OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Kartenkacheln von openstreetmap.org gemäss [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).
- Quartiergrenzen: [Stadt Zürich](https://data.stadt-zuerich.ch/dataset/geo_stadtkreise) (CC0), [Kanton Basel-Stadt](https://data.bs.ch/explore/dataset/100042/) (CC BY 4.0), [Stadt Bern](https://opendata.swiss/de/dataset/stadtteile), [Stadt Lausanne](https://viageo.ch/md/29cfd252-6b51-4798-92af-6f9aaf229dcc) (nichtkommerziell mit Quellenangabe), [Ville de Genève / SITG](https://sitg.ge.ch/donnees/vdg-quartier-ville) und für Winterthur der [Kanton Zürich](https://opendata.swiss/de/dataset/stadtkreise-und-quartiere-zurich-und-winterthur) (freie Nutzung). `npm run districts` lädt sie neu.
- Boulevard-Bewilligungen Basel: [Kanton Basel-Stadt](https://data.bs.ch/explore/dataset/100018/) (CC BY 4.0).
- Preise: die beim Angebot verlinkten Originalkarten der Lokale. Gespeichert werden Preisangaben und kurze Belegzeilen, keine vollständigen Karten.
