"""Discover city bars with OSM, then read public menus with bounded crawling.

Run from repository root: python -m scraper.scrape --discover
"""
import argparse
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import threading
import time
from urllib.parse import urljoin, urlparse, unquote
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
import requests
from scraper.extract import extract_offers, BEER, SIZE, STANGE
from scraper.beer_type import explicit_type, section_type
from scraper.estimates import estimate_types
from scraper.beer_rules import eligible_offer
from scraper.pdf_extract import extract_pdf, pdf_links, table_lines
from scraper.coffee import extract_coffees, coffee_pdf, coffee_types, PRICE as COFFEE_PRICE
from scraper.addresses import tag_address
from scraper.menu_dates import verified_menu_date

from scraper.cities import ROOT, CITY, AREA, DATA_DIR, CACHE_DIR
DATA = DATA_DIR / 'bars.json'
UA = 'WobilligBot/1.0 (+https://github.com/moritzlauper/wobillig)'
EXTRA_VENUES = json.loads((ROOT / 'scraper/additional_venues.json').read_text())
SOURCE_SCOPES = json.loads((ROOT / 'scraper/source_scopes.json').read_text())
COFFEE_SOURCE_SCOPES = json.loads((ROOT / 'scraper/coffee_source_scopes.json').read_text())
REVIEWED_COFFEE_MENUS = json.loads((ROOT / 'scraper/reviewed_coffee_menus.json').read_text())
REVIEWED_MENUS = json.loads((ROOT / 'scraper/reviewed_menus.json').read_text())
WEBSITES = json.loads((ROOT / 'scraper/website_overrides.json').read_text())
# Beer halls and restaurants can be useful beer destinations without an OSM bar tag.
EXTRA_QUERY = ''.join(f'{kind}({int(id)})(area.city);' for kind, id in (key.split('/') for key in EXTRA_VENUES))
QUERY = '[out:json][timeout:90];' + AREA + '(nwr["amenity"~"^(bar|pub|biergarten)$"](area.city);' + (EXTRA_QUERY if CITY == 'zurich' else '') + ');out center tags;'
MENU = re.compile(r'men[uü]|karte|getr(?:[aä]|ae)nk|trinken|drink|beer|bier|bar.?card|coffee|kaffee|cocktail|beverage|angebot', re.I)
SKIP_MENU = re.compile(r'catering|bankett|sitzung|seminar|tagung|meeting|conference|ap[eé]ro.?vorschl|event.?menu|event[._ -](?:wein|getr)|gruppen|anlass|checkliste|vision|mission|geschichte|datenschutz|impressum|zeitung|newspaper|(?:^|[/_. -])press(?:e)?(?:[/_. -]|$)', re.I)
ORDER_MENU = re.compile(r'/(?:bestellen|online-bestellen|online-order|delivery|takeaway|take-away|shop|order)(?:/|\?|$)', re.I)
MAX_BYTES = 8 * 1024 * 1024
MAX_PDF_BYTES = 24 * 1024 * 1024

def now():
    return datetime.now(timezone.utc).isoformat()

def public_url(url):
    """Reject non-public destinations, also on every redirect hop."""
    p = urlparse(url)
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password or p.port not in (None, 80, 443):
        raise ValueError('unsupported_url')
    addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme=='https' else 80))
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('non_public_address')

class Fetcher:
    def __init__(self):
        self.robots = {}
        self.locks = {}
        self.guard = threading.Lock()
        self.last = {}
        self.cache = CACHE_DIR
        self.cache.mkdir(parents=True, exist_ok=True)

    def raw(self, url, delay=1.0):
        public_url(url)
        host = urlparse(url).netloc
        with self.guard:
            lock = self.locks.setdefault(host, threading.RLock())
        with lock:
            time.sleep(max(0, delay - (time.monotonic()-self.last.get(host, 0))))
            try:
                with requests.get(url, headers={'User-Agent':UA}, timeout=(8,15), allow_redirects=False, stream=True) as r:
                    if r.is_redirect:
                        return r.status_code, r.headers, b''
                    limit = MAX_PDF_BYTES if 'application/pdf' in r.headers.get('Content-Type', '').lower() else MAX_BYTES
                    chunks = bytearray()
                    for chunk in r.iter_content(65536):
                        chunks.extend(chunk)
                        if len(chunks) > limit:
                            raise ValueError('response_too_large')
                    return r.status_code, r.headers, bytes(chunks)
            finally:
                self.last[host] = time.monotonic()

    def policy(self, url):
        p = urlparse(url)
        origin = f'{p.scheme}://{p.netloc}'
        with self.guard:
            lock = self.locks.setdefault(p.netloc, threading.RLock())
        with lock:
            if origin in self.robots:
                return self.robots[origin]
            robot = RobotFileParser()
            try:
                target=origin+'/robots.txt'
                for _ in range(4):
                    code,headers,body=self.raw(target)
                    if 300<=code<400:
                        target=urljoin(target,headers.get('Location',''))
                        continue
                    break
                # RFC 9309 §2.3.1.3: unavailable robots.txt (4xx) is not
                # a Disallow rule. Keep rate limits and transient failures closed.
                if 400<=code<500 and code not in (408, 429):
                    robot.parse([])
                elif code==200:
                    robot.parse(body.decode('utf-8',errors='replace').splitlines())
                else:
                    robot.parse(['User-agent: *','Disallow: /'])
            except (requests.RequestException, OSError, ValueError):
                robot.parse(['User-agent: *','Disallow: /'])
            self.robots[origin] = robot
            return robot

    def get(self,url):
        for _ in range(5):
            public_url(url)
            robot=self.policy(url)
            if not robot.can_fetch(UA,url):
                raise ValueError('robots_blocked')
            delay=max(1.0,robot.crawl_delay(UA) or 0)
            rate=robot.request_rate(UA)
            if rate:
                delay=max(delay,rate.seconds/rate.requests)
            if delay>30:
                raise ValueError('crawl_delay_too_long')
            code,headers,body=self.raw(url,delay)
            if 300<=code<400:
                url=urljoin(url,headers.get('Location',''))
                continue
            if code!=200:
                raise ValueError(f'http_{code}')
            return url,headers.get('Content-Type',''),body
        raise ValueError('too_many_redirects')

def discover(previous, path=None, query=QUERY):
    if path:
        raw=json.loads(Path(path).read_text())
    else:
        raw=None
        endpoints=[os.environ.get('OVERPASS_URL','https://overpass.osm.ch/api/interpreter'),'https://overpass-api.de/api/interpreter']
        for endpoint in endpoints:
            try:
                # Keep restaurants discovered by the wider price search on refresh.
                active_query=query
                if query == QUERY:
                    retained=''.join(f"{b['id'].split('/')[0]}({b['id'].split('/')[1]})(area.city);" for b in previous.get('bars',[]) if b.get('type') in ('restaurant','cafe') and re.fullmatch(r'(node|way|relation)/\d+', b['id']))
                    active_query=query.replace(');out center tags;',retained+');out center tags;')
                r=requests.get(endpoint,params={'data':active_query},headers={'User-Agent':UA},timeout=120)
                r.raise_for_status()
                raw=r.json()
                if raw.get('remark') or not raw.get('elements'):
                    raise ValueError('Incomplete or empty Overpass response')
                break
            except (requests.RequestException, ValueError) as exc:
                print(f'Overpass failed: {type(exc).__name__}',flush=True)
                raw=None
        if raw is None:
            raise RuntimeError('Discovery failed; existing dataset was not changed')
    old={b['id']:b for b in previous.get('bars',[])}
    bars=[]
    for el in raw.get('elements',[]):
        tags=el.get('tags',{})
        center=el.get('center',el)
        if not tags.get('name') or 'lat' not in center:
            continue
        id=f"{el['type']}/{el['id']}"
        website=WEBSITES.get(id) or tags.get('website') or tags.get('contact:website') or EXTRA_VENUES.get(id,{}).get('website')
        if website and not website.startswith(('http://','https://')):
            website='https://'+website
        address = tag_address(tags)
        previous_address = old.get(id, {})
        if not address['address']:
            address = {**address, **{k: previous_address[k] for k in ('address', 'postcode', 'addressSource') if previous_address.get(k)}}
        bars.append({'id':id,'name':tags['name'],'lat':center['lat'],'lon':center['lon'],
            'type':tags.get('amenity','bar'),**address,'website':website,
            'cuisine':[c.strip().lower() for c in tags.get('cuisine','').split(';') if c.strip()],
            'openingHours':tags.get('opening_hours'),'outdoor':tags.get('outdoor_seating')=='yes',
            'offers':old.get(id,{}).get('offers',[]),'scrapeStatus':old.get(id,{}).get('scrapeStatus','pending'),
            'checkedAt':old.get(id,{}).get('checkedAt')})
    # Deduplicate identical venue names mapped as both a node and an outline.
    unique=[]
    for b in sorted(bars,key=lambda b:bool(b['website']),reverse=True):
        if not any(b['name'].casefold()==a['name'].casefold() and abs(b['lat']-a['lat'])<.0005 and abs(b['lon']-a['lon'])<.0007 for a in unique):
            unique.append(b)
    if not unique:
        raise RuntimeError('Refusing to overwrite data with an empty discovery')
    return {'generatedAt':now(),'discoveredAt':now(),'attribution':'© OpenStreetMap contributors, ODbL 1.0','bars':sorted(unique,key=lambda b:b['name'].casefold())}

def html_content(body,url,beverage='beer',link_labels=None):
    soup=BeautifulSoup(body,'html.parser')
    title=soup.title.get_text(' ',strip=True) if soup.title else ''
    if re.search(r'online\s+bestellen|essen\s+bestellen|order\s+(?:food\s+)?online|food\s+delivery',title,re.I):
        # Restaurant delivery storefronts are not evidence of on-site prices.
        return '',[]
    # Remove explicitly labelled takeaway sections, including their child rows.
    for heading in list(soup.select('h1,h2,h3,h4,h5,h6')):
        if not re.search(r'take[ -]?away|zum mitnehmen',heading.get_text(' ',strip=True),re.I):
            continue
        level=int(heading.name[1])
        for node in list(heading.find_all_next(string=True)):
            parent=node.find_parent(re.compile(r'^h[1-6]$'))
            if parent is heading:
                continue
            if parent and int(parent.name[1])<=level:
                break
            node.extract()
        heading.decompose()
    links=[]
    if link_labels is None: link_labels={}
    # DearFlip stores the actual PDF in JSON inside its viewer script, not an
    # anchor. Read only the source string; never execute website JavaScript.
    for script in soup.select('script.df-shortcode-script'):
        for match in re.finditer(r'"source"\s*:\s*("(?:\\.|[^"\\])*")', script.get_text()):
            try:
                target = urljoin(url, json.loads(match[1])).split('#')[0]
            except (ValueError, TypeError):
                continue
            if urlparse(target).scheme in ('http', 'https') and urlparse(target).path.lower().endswith('.pdf') and not SKIP_MENU.search(target):
                links.append(target)
    for a in soup.select('a[href], iframe[src], embed[src], object[data], img[src]'):
        target=urljoin(url,a.get('href') or a.get('src') or a.get('data')).split('#')[0]
        # A hostname containing "bier" must not make every site link a menu.
        link_label=a.get_text(' ',strip=True)+' '+a.get('aria-label','')+' '+a.get('title','')+' '+a.get('alt','')+' '+unquote(urlparse(target).path)
        pdf=urlparse(target).path.lower().endswith('.pdf')
        cafe_page = beverage=='coffee' and re.search(r'\b(?:caf[eé]|cafeteria|bistro|restaurant|essen|trinken|food)\b', unquote(link_label), re.I)
        if (MENU.search(link_label) or pdf or cafe_page) and not SKIP_MENU.search(link_label) and urlparse(target).scheme in ('http','https'):
            # Only same-origin navigation; external PDFs are allowed as direct menu links.
            if (urlparse(target).hostname or '').removeprefix('www.')==(urlparse(url).hostname or '').removeprefix('www.') or pdf or urlparse(target).hostname=='api2.lunchgate.ch':
                if beverage=='coffee' and re.search(r'\.(?:jpe?g|png|webp|svg|gif)$',urlparse(target).path,re.I):
                    continue
                links.append(target)
                link_labels[target]=a.get_text(' ',strip=True)+' '+a.get('aria-label','')+' '+a.get('title','')
    for node in soup(['script','style','nav','footer','header']):
        node.decompose()
    rows=parallel_menu_rows(soup)
    # Product cards may put "Flaschenbier" after the price, outside the
    # heading/price row. Use only a single product's own explicit category.
    for card in soup.select('article, [data-drink-card]'):
        headings=card.select('h2,h3,h4,h5,h6')
        if len(headings)!=1:
            continue
        product=headings[0].parent.get_text(' ',strip=True)
        categories=[label for label in card.stripped_strings
                    if section_type(label) in ('draft','bottle','can') and not SIZE.search(label)]
        kinds={section_type(label) for label in categories}
        if len(kinds)==1 and extract_offers(product,url,''):
            rows.append(categories[0]+'\n'+product+'\nBier')
    # Pair only structurally adjacent names and numeric size/price rows.
    # Some menus put several products in one paragraph separated by <br>.
    def product_portions(name, amounts):
        if len(name)>80 or not BEER.search(name) or SIZE.search(name) or re.search(r'\d',name):
            return
        remainder=SIZE.sub('',amounts)
        if SIZE.search(amounts) and re.fullmatch(r'[\d\s.,/|–—-]+',re.sub(r'CHF|Fr\.?','',remainder,flags=re.I)):
            rows.append(name+' '+amounts)

    for label in soup.select('h2,h3,h4,h5,h6,p'):
        name=label.get_text(' ',strip=True)
        sibling=label.find_next_sibling()
        if sibling is not None:
            product_portions(name,sibling.get_text(' ',strip=True))
        if label.find('br'):
            lines=label.get_text('\n',strip=True).splitlines()
            for name,amounts in zip(lines,lines[1:]):
                product_portions(name,amounts)
    # Zurich's public cafeterias publish table cells as JSON in a web component.
    for table in soup.select('stzh-datatable[rows]'):
        try:
            cells=json.loads(table['rows'])
        except (TypeError,ValueError):
            continue
        if not isinstance(cells,list):
            continue
        for row in cells:
            if isinstance(row,list) and len(row)==2 and all(isinstance(c,dict) and isinstance(c.get('value'),str) for c in row):
                rows.append(' '.join(BeautifulSoup(c['value'],'html.parser').get_text(' ',strip=True) for c in row))
    # Some CMS menus use alternating grid cells, not a table or product card.
    # Pair a named, sized product only with its immediately adjacent price cell.
    for cell in soup.select('div, p, li, dt'):
        name=cell.get_text(' ',strip=True)
        if len(name)>160 or not (BEER.search(name) or coffee_types(name)):
            continue
        if not SIZE.search(name) and not STANGE.search(name) and not coffee_types(name):
            continue
        sibling=cell.find_next_sibling()
        if sibling:
            price=sibling.get_text(' ',strip=True)
            if re.fullmatch(r'(?:CHF\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?\s*(?:CHF|Fr\.?)?',price,re.I):
                rows.append(name+' '+price)
    for table in soup.select('table'):
        heading=table.find_previous(re.compile(r'^h[1-6]$'))
        table_rows=([heading.get_text(' ',strip=True)] if heading else [])+[r.get_text(' ',strip=True) for r in table.select('tr')]
        rows.extend(t for t,_ in table_lines([{'text':t,'top':i*10} for i,t in enumerate(table_rows)]))
    for row in soup.select('tr, p, li, div'):
        content=row.get_text(' ',strip=True)
        if len(content)<=350:
            rows.append(content)
            heading=row.find_previous(re.compile(r'^h[1-6]$'))
            if heading and section_type(heading.get_text(' ',strip=True)) in ('draft','bottle','can') and BEER.search(content):
                # Explicitly carry the nearest HTML section label with the row.
                rows.append(heading.get_text(' ',strip=True)+'\n'+content+'\nBier')
            if heading and not BEER.search(content) and re.match(r'^(Herrg[oö]ttli|Herg[oö]ttli|Stange|Grosses|Großes|Panach[eé])\b',content,re.I):
                context=heading.get_text(' ',strip=True)
                if len(context)<70 and BEER.search(context):
                    rows.append(context+' – '+content)
    rows.extend(soup.get_text('\n',strip=True).splitlines())
    return '\n'.join(rows),prioritize_links(links,beverage,link_labels)


def parallel_menu_rows(soup):
    """Pair neighbouring CMS columns only when their explicit row counts agree."""
    rows=[]
    for layout in soup.select('.fluid-engine, .sqs-row'):
        blocks=layout.find_all('div',recursive=False)
        for left,right in zip(blocks,blocks[1:]):
            for names,amounts in ((left,right),(right,left)):
                name_paragraphs=names.select('p');price_paragraphs=amounts.select('p')
                if len(name_paragraphs)!=len(price_paragraphs):
                    continue
                for label,price in zip(name_paragraphs,price_paragraphs):
                    labels=label.get_text('\n',strip=True).splitlines()
                    if not 2<=len(labels)<=30 or sum(bool(coffee_types(x) or BEER.search(x)) for x in labels)<2:
                        continue
                    prices=price.get_text('\n',strip=True).splitlines()
                    if len(labels)==len(prices) and all(re.fullmatch(r'\+?'+COFFEE_PRICE,x,re.I) for x in prices):
                        rows.extend(name+' '+value for name,value in zip(labels,prices))
    return rows


def prioritize_links(links, beverage='beer', labels=None):
    if beverage=='coffee':
        def priority(url):
            path=unquote(urlparse(url).path)
            text=path+' '+(labels or {}).get(url,'')
            # A coffee shop's catalogue or a wine PDF must not exhaust the
            # document budget before the cafe page and its drinks menu.
            irrelevant=bool(re.search(r'shop|product|bohnen|beans|r[oö]st|kurs|course|accessor|gutschein|gift|kund(en)?karte|weinkarte|wine.?list|cocktail',text,re.I))
            if re.search(r'kaffee.?karte|coffee.?menu|getr[aä]nke|getraenke|drinks|beverage|heissgetr|hot.?drinks',text,re.I): rank=0
            elif re.search(r'men[uüù]|speisekarte|barkarte',text,re.I): rank=1
            elif re.search(r'caf[eé]|cafeteria|bistro|restaurant|essen|trinken|food',text,re.I): rank=2
            else: rank=3
            return irrelevant,rank,not path.lower().endswith('.pdf')
        return sorted(dict.fromkeys(links),key=priority)
    # Combined wine/drinks lists can contain all the beers. Keep wine-only
    # documents as a lower priority fallback instead of discarding them.
    def beer_priority(url):
        path=unquote(urlparse(url).path)
        text=path+' '+(labels or {}).get(url,'')
        drinks=bool(re.search(r'bier|beer|getr|trinken|drink|barkarte|beverage',text,re.I))
        wine=bool(re.search(r'weinkarte|wine.?list',text,re.I))
        return not drinks, wine, not path.lower().endswith('.pdf')
    return sorted(dict.fromkeys(links),key=beer_priority)


def source_allowed(bar_id, url, beverage='beer'):
    # Shared restaurant websites must not mix menus from different branches.
    if SKIP_MENU.search(unquote(urlparse(url).path)):
        return False
    if beverage=='coffee' and re.search(r'wochenmen|tagesmen|mittags|lunchkarte|lunchmenu',url,re.I):
        return False
    allowed = COFFEE_SOURCE_SCOPES.get(bar_id, SOURCE_SCOPES.get(bar_id)) if beverage=='coffee' else SOURCE_SCOPES.get(bar_id)
    return not ORDER_MENU.search(url) and (not allowed or any(part.casefold() in url.casefold() for part in allowed))

def beer_menu_hints():
    """Reuse venue-specific drinks menus already found by the coffee crawl."""
    hints=json.loads((ROOT/'scraper/menu_urls.json').read_text())
    coffee_hints=json.loads((ROOT/'scraper/coffee_menu_urls.json').read_text())
    coffee_path=DATA_DIR/'coffee.json'
    if coffee_path.exists():
        for bar in json.loads(coffee_path.read_text()).get('bars',[]):
            coffee_hints.setdefault(bar['id'],[]).extend(
                o['sourceUrl'] for o in bar['offers'] if not o.get('photoSource'))
    for bar_id, urls in coffee_hints.items():
        allowed=[url for url in urls if source_allowed(bar_id,url) and source_allowed(bar_id,url,'coffee')]
        if allowed:
            hints[bar_id]=list(dict.fromkeys(hints.get(bar_id,[])+allowed))
    return hints

def scrape_bar(bar, fetcher, hints, max_pages, beverage='beer'):
    if bar['id'] in WEBSITES:
        bar={**bar,'website':WEBSITES[bar['id']]}
    stamp=now()
    urls=list(hints.get(bar['id'],[]))
    urls.extend(o['sourceUrl'] for o in bar['offers'] if not o.get('photoSource'))
    if bar['website']:
        urls.append(bar['website'])
    if not urls:
        return {**bar,'scrapeStatus':'no_website','checkedAt':stamp}
    urls=list(dict.fromkeys(urls))
    visited=set();offers=[];errors=[];success=0;changed_reviews=set();read_sources=set();attempts=0;link_labels={}
    while urls and attempts<max_pages:
        url=urls.pop(0)
        if url in visited:
            continue
        visited.add(url)
        attempts+=1
        try:
            final,kind,body=fetcher.get(url)
            visited.add(final)
            review=(REVIEWED_COFFEE_MENUS if beverage=='coffee' else REVIEWED_MENUS).get(final)
            if review and review['barId']==bar['id'] and source_allowed(bar['id'],final,beverage):
                if hashlib.sha256(body).hexdigest()==review['sha256']:
                    proof=verified_menu_date(review,body,stamp)
                    offers.extend({**o,**proof,'sourceUrl':final,'observedAt':stamp,'confidence':'reviewed'} for o in review['offers'])
                else:
                    changed_reviews.add(final)
            if 'pdf' in kind or urlparse(final).path.lower().endswith('.pdf'):
                if source_allowed(bar['id'],final,beverage) and not (review and review['barId']==bar['id'] and review.get('exclusive')):
                    offers.extend((coffee_pdf if beverage=='coffee' else extract_pdf)(body,final,stamp))
                links=[link for link in pdf_links(body) if urlparse(link).scheme in ('https','http') and urlparse(link).path.lower().endswith('.pdf') and not SKIP_MENU.search(link)]
            elif 'html' in kind:
                text,links=html_content(body,final,beverage,link_labels)
                if source_allowed(bar['id'],final,beverage):
                    offers.extend((extract_coffees if beverage=='coffee' else extract_offers)(text,final,stamp))
            else:
                continue
            urls=prioritize_links([link for link in links if link not in visited and (not urlparse(link).path.lower().endswith('.pdf') or source_allowed(bar['id'],link,beverage))]+urls,beverage,link_labels)
            read_sources.update((url,final))
            success+=1
        except Exception as exc:
            # One malformed PDF or offline site must not abort the city import.
            errors.append(str(exc) if isinstance(exc,ValueError) else type(exc).__name__)
    # A homepage fetch or a hit in another document says nothing about a menu
    # we could not read. Preserve its prices and original dates independently.
    fresh_offers=bool(offers)
    offers.extend(o for o in bar['offers'] if o['sourceUrl'] not in read_sources and o['sourceUrl'] not in changed_reviews and source_allowed(bar['id'],o['sourceUrl'],beverage))
    dedup={}
    for o in offers:
        if beverage == 'beer' and not eligible_offer(o): continue
        if beverage == 'coffee' and o.get('coffeeType') == 'matcha': continue
        # Expiring download signatures are not useful public source links.
        # Keep the menu's originating venue page as the durable reference.
        if re.search(r'[?&]X-Amz-Signature=',o['sourceUrl'],re.I) and bar.get('website'):
            o={**o,'sourceUrl':bar['website']}
        if beverage=='beer':o.setdefault('beerType',explicit_type(o.get('evidence','')) or 'unknown')
        dedup.setdefault((o.get('coffeeType',o['name'].casefold()),o['volumeMl'],o['priceChf'],o.get('beerType')),o)
    if beverage=='beer':
        known={key[:3] for key in dedup if key[3]!='unknown'}
        dedup={key:o for key,o in dedup.items() if key[3]!='unknown' or key[:3] not in known}
    # Preserve the last known offers (with their original date) when a crawl fails.
    if fresh_offers:
        result=list(dedup.values())
        status='prices_found'
    elif changed_reviews:
        result=list(dedup.values())
        status='review_required'
    elif success and not errors:
        result=list(dedup.values())
        status='prices_found' if result else 'no_prices'
    else:
        result=list(dedup.values())
        status='partial' if success else ('robots_blocked' if errors and all(x=='robots_blocked' for x in errors) else 'fetch_failed')
    return {**bar,'offers':result,'checkedAt':stamp,'scrapeStatus':status}

def write(data):
    estimate_types(data['bars'])
    DATA.parent.mkdir(parents=True,exist_ok=True)
    temp=DATA.with_suffix('.tmp')
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    temp.replace(DATA)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover',action='store_true')
    parser.add_argument('--osm-file',help='Import a saved Overpass JSON response')
    parser.add_argument('--discover-only',action='store_true')
    parser.add_argument('--limit',type=int,default=0)
    parser.add_argument('--workers',type=int,default=6)
    parser.add_argument('--max-pages',type=int,default=8)
    parser.add_argument('--name',help='Only scrape names containing this text')
    parser.add_argument('--type',action='append',choices=['bar','pub','biergarten','restaurant','cafe'],help='Only these venue types; repeatable')
    parser.add_argument('--missing-prices',action='store_true',help='Focus on venues without any recorded beer price')
    parser.add_argument('--missing-bottles',action='store_true',help='Revisit venues without bottle prices, including those with draft prices')
    args=parser.parse_args()
    dataset=json.loads(DATA.read_text()) if DATA.exists() else {}
    if args.discover or args.osm_file or not dataset:
        dataset=discover(dataset,args.osm_file)
        write(dataset)
    if args.discover_only:
        print(f"Discovered {len(dataset['bars'])} locations")
        return
    hints=beer_menu_hints()
    fetcher=Fetcher()
    bars=[b for b in dataset['bars'] if not args.name or args.name.casefold() in b['name'].casefold()]
    bars=[b for b in bars if (not args.type or b['type'] in args.type) and (not args.missing_prices or not b['offers'])]
    if args.missing_bottles:
        bars=[b for b in bars if not any(o.get('beerType')=='bottle' or (o.get('beerType','unknown')=='unknown' and o.get('beerTypeEstimate',{}).get('type')=='bottle') for o in b['offers'])]
    # Oldest checks first so limited runs do not repeatedly hit the same venues.
    bars.sort(key=lambda b:b['checkedAt'] or '')
    if args.limit:
        bars=bars[:args.limit]
    by_id={b['id']:b for b in dataset['bars']}
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        tasks=[pool.submit(scrape_bar,b,fetcher,hints,args.max_pages) for b in bars]
        for i,task in enumerate(as_completed(tasks),1):
            b=task.result();by_id[b['id']]=b
            print(f"[{i}/{len(tasks)}] {b['name']}: {b['scrapeStatus']} ({len(b['offers'])} offers)",flush=True)
            if i%20==0:
                dataset['bars']=list(by_id.values());dataset['generatedAt']=now();write(dataset)
    dataset['bars']=list(by_id.values());dataset['generatedAt']=now();write(dataset)
    print(f"Saved {len(dataset['bars'])} bars; {sum(bool(b['offers']) for b in dataset['bars'])} with prices")

if __name__=='__main__':
    main()
