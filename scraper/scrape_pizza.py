"""Crawl Zurich restaurant menus for regular Margherita pizzas.

python -m scraper.scrape_pizza --discover --limit 0
Audited source bodies are cached for inspection; shared chain menus need explicit
venue-specific hints. Conflicting prices stay unpublished until reviewed.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse, urljoin
from bs4 import BeautifulSoup

from scraper.scrape import ROOT, discover, now, html_content, SKIP_MENU, ORDER_MENU
from scraper.enrich import AuditFetcher, host
from scraper.pdf_extract import pdf_links
from scraper.pizza import pizza_html, pizza_pdf
from scraper.scrape_coffee import save, ArchiveFetcher

DATA=ROOT/'public/data/pizza.json'
CHECKS=ROOT/'scraper/pizza_checks.json'
QUERY='[out:json][timeout:90];area["name"="Zürich"]["admin_level"="8"]->.city;nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"]["name"](area.city);out center tags;'
SKIP=re.compile(r'take[ _-]?away|delivery|liefer|kinder|bambini|lunch|mittag|wochen|tagesmen|weine|wine|getr[aä]nke|drinks|cocktail',re.I)
HINTS_PATH=ROOT/'scraper/pizza_menu_urls.json'
REVIEWS_PATH=ROOT/'scraper/reviewed_pizza_menus.json'


def skip_source(url):
    path=urlparse(url).path
    if re.search(r'take[ _-]?away|delivery|liefer|kinder|bambini|lunch|mittag|wochen|tagesmen',path,re.I):
        return True
    return bool(SKIP.search(path) and not re.search(r'speise|pizza|food|essen',path,re.I))


def pizza_links(body, url):
    """Food and pizza links need broader labels than the drinks crawler."""
    result=[]
    soup=BeautifulSoup(body,'html.parser')
    for a in soup.select('a[href],iframe[src],img[src]'):
        target=urljoin(url,a.get('href') or a.get('src')).split('#')[0]
        label=a.get_text(' ',strip=True)+' '+a.get('alt','')+' '+urlparse(target).path
        if re.search(r'pizz|pizze|speise|food|essen|dinner|carte|carta',label,re.I) and not re.search(r'bestell|delivery|take.?away|shop|order',label,re.I):
            if host(target)==host(url) or urlparse(target).path.lower().endswith('.pdf'):
                result.append(target)
    return result


def crawl(bar,fetcher,hints,max_pages,reviews):
    stamp=now();queue=list(hints.get(bar['id'],[]))+[bar['website']]
    visited=set();offers=[];errors=[];success=0;changed=set()
    while queue and len(visited)<max_pages:
        url=queue.pop(0)
        if not url or url in visited or ORDER_MENU.search(url) or SKIP_MENU.search(url):continue
        visited.add(url)
        try:
            final,kind,body=fetcher.get(url)
            if isinstance(fetcher,ArchiveFetcher):stamp=fetcher.docs[final]['stamp']
            reviewed=[r for r in reviews if r['url']==final and bar['id'] in r['barIds']]
            for r in reviewed:
                if hashlib.sha256(body).hexdigest()==r['sha256']:
                    offers.extend({**o,'sourceUrl':final,'observedAt':stamp,'confidence':'reviewed'} for o in r['offers'])
                else:changed.add(final)
            if 'pdf' in kind or urlparse(final).path.lower().endswith('.pdf'):
                found=[] if reviewed else pizza_pdf(body,final,stamp)
                links=pdf_links(body)
            elif 'html' in kind:
                found=[] if reviewed else pizza_html(body,final,stamp)
                _,links=html_content(body,final)
                links+=pizza_links(body,final)
            else:continue
            if not skip_source(final) and (not hints.get(bar['id']) or url in hints[bar['id']]):offers.extend(found)
            # Hints scope shared websites to the confirmed location menu(s).
            if hints.get(bar['id']):links=[u for u in links if u in hints[bar['id']]]
            links=[u for u in links if u not in visited and not skip_source(u) and not SKIP_MENU.search(u) and not ORDER_MENU.search(u)]
            queue=sorted(dict.fromkeys(links+queue),key=lambda u:(not bool(re.search(r'pizza|speise|food|essen|menu|karte',urlparse(u).path,re.I)),not urlparse(u).path.lower().endswith('.pdf')))
            success+=1
        except Exception as exc:
            errors.append({'url':url,'error':str(exc)[:150] if isinstance(exc,ValueError) else type(exc).__name__})
    unique={}
    for o in sorted(offers,key=lambda o:o['confidence']!='reviewed'):
        unique.setdefault(o['priceChf'],o)
    if len(unique)>1:
        result=[];status='ambiguous_prices'
    elif unique:result=list(unique.values());status='prices_found'
    elif changed:result=[];status='review_required'
    elif success and not errors:result=[];status='no_prices'
    else:result=[o for o in bar.get('offers',[]) if o['sourceUrl'] not in changed];status='partial' if success else 'fetch_failed'
    return {**bar,'offers':result,'checkedAt':stamp,'scrapeStatus':status}, {'checkedAt':stamp,'status':status,'visited':sorted(visited),'errors':errors,'candidates':list(unique.values())}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--discover',action='store_true');p.add_argument('--venues-file');p.add_argument('--limit',type=int,default=0)
    p.add_argument('--workers',type=int,default=8);p.add_argument('--max-pages',type=int,default=6)
    p.add_argument('--archive-dir',action='append',default=[]);p.add_argument('--only',help='Venue name regex');p.add_argument('--retry',action='store_true')
    args=p.parse_args()
    old=json.loads(DATA.read_text()) if DATA.exists() else {'bars':[]}
    if args.venues_file:found=json.loads(Path(args.venues_file).read_text())
    elif args.discover or not old['bars']:found=discover({},query=QUERY)
    else:found=old
    hints=json.loads(HINTS_PATH.read_text()) if HINTS_PATH.exists() else {}
    reviews=json.loads(REVIEWS_PATH.read_text()) if REVIEWS_PATH.exists() else []
    checks=json.loads(CHECKS.read_text()) if CHECKS.exists() else {}
    hosts=Counter(host(b['website']) for b in found['bars'] if b['website'])
    prior={b['id']:b for b in old['bars']}
    selected=[{**b,'offers':prior.get(b['id'],{}).get('offers',[])} for b in found['bars'] if b['website'] and (b['type'] in ('restaurant','fast_food') or re.search(r'pizz',b['name'],re.I)) and (hosts[host(b['website'])]==1 or b['id'] in hints)]
    if args.only:selected=[b for b in selected if re.search(args.only,b['name'],re.I)]
    if args.retry:selected=[b for b in selected if checks.get(b['id'],{}).get('status')!='prices_found']
    selected.sort(key=lambda b:(not bool(re.search(r'pizz|ital|napol|rosso|luigia|leone|lucia|molino|trattoria|ristorante',b['name'],re.I)),checks.get(b['id'],{}).get('checkedAt',''),b['name'].casefold()))
    if args.limit:selected=selected[:args.limit]
    print(f'{len(found["bars"])} locations; crawling {len(selected)} eligible websites',flush=True)
    fetcher=ArchiveFetcher(args.archive_dir) if args.archive_dir else AuditFetcher(ROOT/'scraper/cache/pizza')
    output=dict(prior)
    def flush():
        save(DATA,{'generatedAt':now(),'discoveredAt':found.get('discoveredAt',now()),'attribution':found.get('attribution','© OpenStreetMap contributors, ODbL 1.0'),'bars':sorted(output.values(),key=lambda b:b['name'].casefold())})
        save(CHECKS,checks)
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        tasks=[pool.submit(crawl,b,fetcher,hints,args.max_pages,reviews) for b in selected]
        for i,task in enumerate(as_completed(tasks),1):
            b,check=task.result();checks[b['id']]=check
            if b['offers'] or b['id'] in output or re.search(r'pizzeria|pizza',b['name'],re.I):output[b['id']]=b
            print(f'[{i}/{len(tasks)}] {b["name"]}: {b["scrapeStatus"]} '+str([o['priceChf'] for o in b['offers']]),flush=True)
            if i%20==0:flush()
    flush()
    print(f'{sum(bool(b["offers"]) for b in output.values())} venues with verified-source Margherita prices',flush=True)


if __name__=='__main__':main()
