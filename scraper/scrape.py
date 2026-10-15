"""Discover Zurich bars with OSM, then read public menus with bounded crawling.

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
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
import requests
from scraper.extract import extract_offers, BEER
from scraper.pdf_extract import extract_pdf, pdf_links, table_lines

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data/bars.json'
UA = 'WoguenstigBot/1.0 (+https://github.com/moritzlauper/woguenstig)'
EXTRA_VENUES = json.loads((ROOT / 'scraper/additional_venues.json').read_text())
SOURCE_SCOPES = json.loads((ROOT / 'scraper/source_scopes.json').read_text())
REVIEWED_MENUS = json.loads((ROOT / 'scraper/reviewed_menus.json').read_text())
# Beer halls and restaurants can be useful beer destinations without an OSM bar tag.
EXTRA_QUERY = ''.join(f'{kind}({int(id)})(area.city);' for kind, id in (key.split('/') for key in EXTRA_VENUES))
QUERY = '[out:json][timeout:90];area["name"="Zürich"]["admin_level"="8"]->.city;(nwr["amenity"~"^(bar|pub|biergarten)$"](area.city);' + EXTRA_QUERY + ');out center tags;'
MENU = re.compile(r'men[uü]|karte|getr[aä]nk|drink|beer|bier|bar.?card', re.I)
SKIP_MENU = re.compile(r'catering|bankett|ap[eé]ro.?karte|ap[eé]ro.?vorschl|event.?menu|gruppen|anlass|checkliste|vision|mission|geschichte|weinkarte|wine.?list|datenschutz|impressum', re.I)
MAX_BYTES = 8 * 1024 * 1024

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
        self.cache = ROOT / 'scraper/cache'
        self.cache.mkdir(exist_ok=True)

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
                    chunks = bytearray()
                    for chunk in r.iter_content(65536):
                        chunks.extend(chunk)
                        if len(chunks) > MAX_BYTES:
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
                if code==404:
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

def discover(previous, path=None):
    if path:
        raw=json.loads(Path(path).read_text())
    else:
        raw=None
        endpoints=[os.environ.get('OVERPASS_URL','https://overpass.osm.ch/api/interpreter'),'https://overpass-api.de/api/interpreter']
        for endpoint in endpoints:
            try:
                r=requests.get(endpoint,params={'data':QUERY},headers={'User-Agent':UA},timeout=120)
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
        website=tags.get('website') or tags.get('contact:website') or EXTRA_VENUES.get(id,{}).get('website')
        if website and not website.startswith(('http://','https://')):
            website='https://'+website
        bars.append({'id':id,'name':tags['name'],'lat':center['lat'],'lon':center['lon'],
            'type':tags.get('amenity','bar'),'address':' '.join(filter(None,[tags.get('addr:street'),tags.get('addr:housenumber')])),
            'postcode':tags.get('addr:postcode',''),'website':website,
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

def html_content(body,url):
    soup=BeautifulSoup(body,'html.parser')
    links=[]
    for a in soup.select('a[href], iframe[src], embed[src], object[data], img[src]'):
        target=urljoin(url,a.get('href') or a.get('src') or a.get('data')).split('#')[0]
        # A hostname containing "bier" must not make every site link a menu.
        link_label=a.get_text(' ',strip=True)+' '+urlparse(target).path
        pdf=urlparse(target).path.lower().endswith('.pdf')
        if (MENU.search(link_label) or pdf) and not SKIP_MENU.search(link_label) and urlparse(target).scheme in ('http','https'):
            # Only same-origin navigation; external PDFs are allowed as direct menu links.
            if urlparse(target).netloc==urlparse(url).netloc or pdf or urlparse(target).hostname=='api2.lunchgate.ch':
                links.append(target)
    for node in soup(['script','style','nav','footer','header']):
        node.decompose()
    rows=[]
    for table in soup.select('table'):
        heading=table.find_previous(re.compile(r'^h[1-6]$'))
        table_rows=([heading.get_text(' ',strip=True)] if heading else [])+[r.get_text(' ',strip=True) for r in table.select('tr')]
        rows.extend(t for t,_ in table_lines([{'text':t,'top':i*10} for i,t in enumerate(table_rows)]))
    for row in soup.select('tr, p, li, div'):
        content=row.get_text(' ',strip=True)
        if len(content)<=350:
            rows.append(content)
            heading=row.find_previous(re.compile(r'^h[1-6]$'))
            if heading and not BEER.search(content) and re.match(r'^(Herrg[oö]ttli|Herg[oö]ttli|Stange|Grosses|Großes|Panach[eé])\b',content,re.I):
                context=heading.get_text(' ',strip=True)
                if len(context)<70 and BEER.search(context):
                    rows.append(context+' – '+content)
    rows.extend(soup.get_text('\n',strip=True).splitlines())
    return '\n'.join(rows),prioritize_links(links)


def prioritize_links(links):
    return sorted(dict.fromkeys(links),key=lambda u:(not bool(re.search(r'bier|beer|getr|drink|barkarte|beverage',urlparse(u).path,re.I)),not urlparse(u).path.lower().endswith('.pdf')))


def source_allowed(bar_id, url):
    # Shared restaurant websites must not mix menus from different branches.
    allowed = SOURCE_SCOPES.get(bar_id)
    return not allowed or any(part.casefold() in url.casefold() for part in allowed)

def scrape_bar(bar, fetcher, hints, max_pages):
    stamp=now()
    urls=list(hints.get(bar['id'],[]))
    if bar['website']:
        urls.append(bar['website'])
    if not urls:
        return {**bar,'scrapeStatus':'no_website','checkedAt':stamp}
    visited=set();offers=[];errors=[];success=0;changed_reviews=set()
    while urls and len(visited)<max_pages:
        url=urls.pop(0)
        if url in visited:
            continue
        visited.add(url)
        try:
            final,kind,body=fetcher.get(url)
            review=REVIEWED_MENUS.get(final)
            if review and review['barId']==bar['id']:
                if hashlib.sha256(body).hexdigest()==review['sha256']:
                    offers.extend({**o,'sourceUrl':final,'observedAt':stamp,'confidence':'reviewed'} for o in review['offers'])
                else:
                    changed_reviews.add(final)
            if 'pdf' in kind or urlparse(final).path.lower().endswith('.pdf'):
                if source_allowed(bar['id'],final):
                    offers.extend(extract_pdf(body,final,stamp))
                links=[link for link in pdf_links(body) if urlparse(link).scheme in ('https','http') and urlparse(link).path.lower().endswith('.pdf') and not SKIP_MENU.search(link)]
            elif 'html' in kind:
                text,links=html_content(body,final)
                if source_allowed(bar['id'],final):
                    offers.extend(extract_offers(text,final,stamp))
            else:
                continue
            urls=prioritize_links([link for link in links if link not in visited and (not urlparse(link).path.lower().endswith('.pdf') or source_allowed(bar['id'],link))]+urls)
            success+=1
        except Exception as exc:
            # One malformed PDF or offline site must not abort the city import.
            errors.append(str(exc) if isinstance(exc,ValueError) else type(exc).__name__)
    dedup={}
    for o in offers:
        dedup.setdefault((o['name'].casefold(),o['volumeMl'],o['priceChf']),o)
    # Preserve the last known offers (with their original date) when a crawl fails.
    if offers:
        result=list(dedup.values())
        status='prices_found'
    elif changed_reviews:
        result=[o for o in bar['offers'] if o['sourceUrl'] not in changed_reviews]
        status='review_required'
    elif success and not errors:
        result=[]
        status='no_prices'
    else:
        result=bar['offers']
        status='partial' if success else ('robots_blocked' if errors and all(x=='robots_blocked' for x in errors) else 'fetch_failed')
    return {**bar,'offers':result,'checkedAt':stamp,'scrapeStatus':status}

def write(data):
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
    args=parser.parse_args()
    dataset=json.loads(DATA.read_text()) if DATA.exists() else {}
    if args.discover or args.osm_file or not dataset:
        dataset=discover(dataset,args.osm_file)
        write(dataset)
    if args.discover_only:
        print(f"Discovered {len(dataset['bars'])} locations")
        return
    hints=json.loads((ROOT/'scraper/menu_urls.json').read_text())
    fetcher=Fetcher()
    bars=[b for b in dataset['bars'] if not args.name or args.name.casefold() in b['name'].casefold()]
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
