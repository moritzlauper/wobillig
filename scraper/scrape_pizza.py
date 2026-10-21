"""Crawl pizza menus, comparing Margheritas and listing other varieties separately.

python -m scraper.scrape_pizza --discover --limit 0
Audited source bodies are cached for inspection; shared chain menus are scoped
to explicit hints or distinct OSM branch pages and their structured menu links. Conflicting prices stay unpublished until reviewed.
"""
from scraper.cities import DATA_DIR, STATE_DIR, CACHE_DIR, venue_query
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse, urljoin, parse_qs, unquote
from bs4 import BeautifulSoup

from scraper.scrape import ROOT, discover, now, html_content, SKIP_MENU
from scraper.enrich import AuditFetcher, host
from scraper.pdf_extract import pdf_links
from scraper.pizza import pizza_html, pizza_pdf, pizza_image, structured_menu_links, orderstar_menu_url, pizza_orderstar
from scraper.menu_dates import verified_menu_date
from scraper.scrape_coffee import save, ArchiveFetcher

DATA=DATA_DIR/'pizza.json'
CHECKS=STATE_DIR/'pizza_checks.json'
QUERY = venue_query('restaurant|cafe|fast_food|bar|pub')
SKIP=re.compile(r'take[ _-]?away|delivery|liefer|kinder|bambini|lunch|mittag|wochen|tagesmen|weine|wine|getr[aä]nke|drinks|cocktail',re.I)
HINTS_PATH=ROOT/'scraper/pizza_menu_urls.json'
REVIEWS_PATH=ROOT/'scraper/reviewed_pizza_menus.json'
EXCLUSIONS_PATH=ROOT/'scraper/pizza_exclusions.json'


def is_pizza_venue(bar):
    """Pizza identity does not depend on finding a publishable price."""
    cuisine = bar.get('cuisine', [])
    if isinstance(cuisine, str):
        cuisine = cuisine.split(';')
    return ('pizza' in [c.strip().lower() for c in cuisine]
            or bool(re.search(r'pizz(?:a|eria|e)', bar['name'], re.I))
            or bool(bar.get('pizzaEvidence'))
            or any(o.get('pizzaType') for o in bar.get('offers', [])))


def scoped_hints(bars, hints):
    """Distinct OSM branch pages may be checked without borrowing chain prices."""
    result = dict(hints)
    hosts = Counter(host(b['website']) for b in bars if b.get('website'))
    urls = Counter(b['website'].rstrip('/') for b in bars if b.get('website'))
    for bar in bars:
        url = bar.get('website')
        if (url and hosts[host(url)] > 1 and urls[url.rstrip('/')] == 1
                and urlparse(url).path.strip('/') and bar['id'] not in result):
            result[bar['id']] = [url]
    return result


def skip_source(url):
    parsed=urlparse(url)
    if parsed.scheme not in ('http','https'):return True
    # Never follow action links (including GET-based carts and wishlists).
    if any(re.search(r'cart|wishlist|checkout|nonce|action|remove|delete',key,re.I) for key in parse_qs(parsed.query)):return True
    path=unquote(parsed.path)
    if re.search(r'/(?:cart|warenkorb|checkout|kasse|mein-konto|my-account)(?:/|$)',path,re.I):return True
    if re.search(r'take[ _-]?away|mitnehmen|delivery|liefer|kinder|bambini|lunch|mittag|wochen|tagesmen|menu[ _/-](?:du[ _-]jour|de[ _-]la[ _-]semaine|del[ _-]giorno)|plat[ _-]du[ _-]jour',path,re.I):
        return True
    return bool(SKIP.search(path) and not re.search(r'speise|pizza|food|essen|menu|karte',path,re.I))


def pizza_links(body, url):
    """Follow menu pages and their image documents, including lazy-loaded scans."""
    result=[]
    soup=BeautifulSoup(body,'html.parser')
    menu_page=bool(re.search(r'menu|speise|karte|carta|carte|pizza|food',urlparse(url).path,re.I))
    for a in soup.select('a[href],iframe[src],img'):
        value=a.get('href') or a.get('data-src') or a.get('data-lazy-src') or a.get('src')
        if not value:continue
        target=urljoin(url,value).split('#')[0]
        if skip_source(target):continue
        # Wix display crops are too small for OCR; retain the linked original.
        if a.name=='img' and host(target)=='static.wixstatic.com' and '/v1/' in target:
            target=target.split('/v1/')[0]
        label=a.get_text(' ',strip=True)+' '+a.get('alt','')+' '+urlparse(target).path
        image=a.name=='img'
        if image and (re.search(r'logo|icon|banner|avatar|favicon',label,re.I) or urlparse(target).path.endswith('.svg')):continue
        relevant=bool(re.search(r'pizz|speise|food|essen|dinner|carte|carta|men[uü]|karte|bestell|order',label,re.I))
        wix_gallery=image and host(target)=='static.wixstatic.com' and len(soup.select('img'))<=20 and bool(re.search(r'pizza|speisekarte',soup.get_text(' ',strip=True),re.I))
        if relevant or (image and menu_page) or wix_gallery:
            document=bool(re.search(r'\.(?:pdf|jpe?g|png|webp)$',urlparse(target).path,re.I))
            if host(target)==host(url) or host(target).endswith('.'+host(url)) or document:result.append(target)
    return list(dict.fromkeys(result))


def menu_priority(url):
    path=urlparse(url).path.lower()
    rank=0 if re.search('pizza|pizze|margherita',path) else 1 if re.search('speise|food|essen',path) else 2 if re.search('menu|karte|carta|carte',path) else 3
    return rank, not path.endswith('.pdf'), bool(re.search(r'\.(?:jpe?g|png|webp)$',path))


def resolve_pizza_menu(items):
    """A conflict affects its named pizza only, never the Margherita comparison."""
    groups = {}
    for item in items:
        key = re.sub(r'^pizza\s+', '', ' '.join(item['name'].casefold().split()))
        groups.setdefault(key, []).append(item)
    result, conflicts = [], []
    for key, candidates in sorted(groups.items()):
        restaurant = [o for o in candidates if o.get('priceContext') != 'online_menu']
        candidates = restaurant or candidates
        prices = {o['priceChf'] for o in candidates}
        if len(prices) != 1:
            conflicts.append({'name': key, 'candidates': candidates})
            continue
        # Prefer a sourced ingredient description when the price is identical.
        result.append(max(candidates, key=lambda o: (bool(o.get('ingredients')), o.get('observedAt', ''))))
    return result, conflicts


def crawl(bar,fetcher,hints,max_pages,reviews,ai=None,max_ai_documents=60):
    stamp=now();queue=list(hints.get(bar['id'],[]))+[bar['website']]
    bar = dict(bar)
    visited=set();offers=[];errors=[];success=0;changed=set()
    allowed = set(hints.get(bar['id'], []))
    online_feeds = set()
    ai_documents = set()
    menu = []; document_hashes = {}
    while queue and len(visited)<max_pages:
        url=queue.pop(0)
        if not url or url in visited or skip_source(url) or SKIP_MENU.search(url):continue
        visited.add(url)
        try:
            final,kind,body=fetcher.get(url)
            if isinstance(fetcher,ArchiveFetcher):stamp=fetcher.docs[final]['stamp']
            reviewed=[r for r in reviews if r['url']==final and bar['id'] in r['barIds']]
            for r in reviewed:
                if hashlib.sha256(body).hexdigest()==r['sha256']:
                    proof=verified_menu_date(r,body,stamp)
                    offers.extend({**o,**proof,'sourceUrl':final,'observedAt':stamp,'confidence':'reviewed'} for o in r['offers'])
                else:changed.add(final)
            if 'pdf' in kind or urlparse(final).path.lower().endswith('.pdf'):
                kind = 'application/pdf'
                found=[] if reviewed else pizza_pdf(body,final,stamp)
                links=[u for u in pdf_links(body) if re.search(r'\.(?:pdf|jpe?g|png|webp)$',urlparse(u).path,re.I)]
            elif 'html' in kind:
                found=[] if reviewed else pizza_html(body,final,stamp,all_pizzas=True)
                soup = BeautifulSoup(body, 'html.parser')
                title = soup.title.get_text(' ', strip=True) if soup.title else ''
                if re.search(r'\bpizzeri[ae]\b', title, re.I):
                    bar['pizzaEvidence'] = {'sourceUrl': final, 'evidence': title[:200]}
                _,links=html_content(body,final)
                links+=pizza_links(body,final)
                menu_links = structured_menu_links(body, final)
                feed = orderstar_menu_url(body, final)
                if feed:
                    menu_links.append(feed); online_feeds.add(feed)
                links += menu_links
                if url in allowed:
                    # A branch page owns its directly linked menu documents.
                    allowed.update(menu_links)
                    allowed.update(u for u in links if re.search(r'\.(?:pdf|jpe?g|png|webp)$',urlparse(u).path,re.I))
            elif kind.startswith('image/'):
                found=[] if reviewed else pizza_image(body,final,stamp);links=[]
            elif url in online_feeds and 'json' in kind:
                found=pizza_orderstar(body,final,stamp,all_pizzas=True);links=[]
            else:continue
            if not skip_source(final) and (not hints.get(bar['id']) or url in allowed):
                digest = hashlib.sha256(body).hexdigest()
                document_hashes[final] = digest
                for offer in found:
                    offer['sourceSha256'] = digest
                    prior_ingredients = next((o.get('ingredients') for o in bar.get('offers', [])
                                              if o.get('sourceUrl') == final and o.get('sourceSha256') == digest
                                              and o.get('name') == offer['name']
                                              and o['priceChf'] == offer['priceChf'] and o.get('ingredients')), None)
                    if prior_ingredients: offer['ingredients'] = prior_ingredients
                # A text-parser miss cannot erase a still-identical visual source.
                if not found and not reviewed:
                    found = [o for o in bar.get('offers', []) if o.get('confidence') == 'ai'
                             and o.get('sourceUrl') == final and o.get('sourceSha256') == digest]
                if (ai and (not reviewed or all(r['sha256'] == digest for r in reviewed)) and digest not in ai_documents
                        and len(ai_documents) < max_ai_documents
                        and ('pdf' in kind or 'html' in kind or kind.startswith('image/'))):
                    ai_documents.add(digest)
                    try:
                        extracted = ai.extract(bar, body, kind, final, stamp)
                        menu.extend(o for o in extracted if o.get('pizzaType') == 'other')
                        regular = [o for o in extracted if o.get('pizzaType') == 'margherita']
                        for offer in offers + found:
                            if offer.get('pizzaType') != 'margherita': continue
                            ingredient_match = next((o for o in regular if o['sourceUrl'] == offer['sourceUrl']
                                                     and o['priceChf'] == offer['priceChf'] and o.get('ingredients')), None)
                            if ingredient_match:
                                offer['ingredients'] = ingredient_match['ingredients']
                                offer['sourceSha256'] = digest
                        if not reviewed: found.extend(regular)
                    except Exception as exc:
                        errors.append({'url':final,'error':'pizza_ai: '+type(exc).__name__})
                menu.extend(o for o in found if o.get('pizzaType') == 'other')
                offers.extend(o for o in found if o.get('pizzaType') != 'other')
            # Hints scope shared websites to the confirmed location menu(s).
            if hints.get(bar['id']):links=[u for u in links if u in allowed]
            links=[u for u in links if u not in visited and not skip_source(u) and not SKIP_MENU.search(u)]
            queue=sorted(dict.fromkeys(links+queue),key=menu_priority)
            success+=1
        except Exception as exc:
            errors.append({'url':url,'error':str(exc)[:150] if isinstance(exc,ValueError) else type(exc).__name__})
    # Restaurant menus take precedence over separately labelled ordering prices.
    restaurant_offers=[o for o in offers if o.get('priceContext')!='online_menu']
    if restaurant_offers: offers=restaurant_offers
    unique={}
    for o in sorted(offers,key=lambda o:o['confidence']!='reviewed'):
        unique.setdefault(o['priceChf'],o)
    if len(unique)>1:
        result=[];status='ambiguous_prices'
    elif unique:result=list(unique.values());status='prices_found'
    elif changed:result=[];status='review_required'
    elif success and not errors:result=[];status='no_prices'
    else:result=[o for o in bar.get('offers',[]) if o['sourceUrl'] not in changed];status='partial' if success else 'fetch_failed'
    # Failed/unvisited sources retain their original date. A changed source must
    # be read again before any old supplementary price can be republished.
    menu.extend(o for o in bar.get('pizzaMenu', []) if not skip_source(o['sourceUrl'])
                and (not hints.get(bar['id']) or o['sourceUrl'] in allowed)
                and (o['sourceUrl'] not in document_hashes or o.get('sourceSha256') == document_hashes[o['sourceUrl']]))
    pizza_menu, menu_conflicts = resolve_pizza_menu(menu)
    return {**bar,'offers':result,'pizzaMenu':pizza_menu,'checkedAt':stamp,'scrapeStatus':status}, {'checkedAt':stamp,'status':status,'visited':sorted(visited),'errors':errors,'candidates':list(unique.values()),'pizzaMenuCount':len(pizza_menu),'pizzaMenuConflicts':menu_conflicts}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--discover',action='store_true');p.add_argument('--venues-file');p.add_argument('--limit',type=int,default=0)
    p.add_argument('--workers',type=int,default=8);p.add_argument('--max-pages',type=int,default=20)
    p.add_argument('--archive-dir',action='append',default=[]);p.add_argument('--only',help='Venue name regex');p.add_argument('--retry',action='store_true')
    p.add_argument('--ai-budget-usd',type=float,default=0,help='Optional shared pizza-only AI budget, capped at 5 USD')
    p.add_argument('--ai-max-documents',type=int,default=60)
    p.add_argument('--ai-minutes',type=float,default=330)
    args=p.parse_args()
    import math
    if not math.isfinite(args.ai_budget_usd) or not 0 <= args.ai_budget_usd <= 5:
        p.error('--ai-budget-usd must be between 0 and 5 USD')
    if args.ai_max_documents < 1 or not math.isfinite(args.ai_minutes) or not 0 < args.ai_minutes <= 330:
        p.error('AI document limit must be positive; AI minutes must be within (0, 330]')
    ai = None
    if args.ai_budget_usd:
        from scraper.pizza_ai import PizzaAI
        ai = PizzaAI(args.ai_budget_usd, CACHE_DIR/'pizza-ai', args.ai_minutes)
        print(f'Complete pizza-menu AI scan: maximum {args.ai_budget_usd:.2f} USD, {args.ai_max_documents} documents/venue',flush=True)
    old=json.loads(DATA.read_text()) if DATA.exists() else {'bars':[]}
    if args.venues_file:found=json.loads(Path(args.venues_file).read_text())
    elif args.discover or not old['bars']:
        found=discover({},query=QUERY)
        save(CACHE_DIR/'pizza-venues.json', found)
    else:found=old
    hints=json.loads(HINTS_PATH.read_text()) if HINTS_PATH.exists() else {}
    reviews=json.loads(REVIEWS_PATH.read_text()) if REVIEWS_PATH.exists() else []
    checks=json.loads(CHECKS.read_text()) if CHECKS.exists() else {}
    exclusions=json.loads(EXCLUSIONS_PATH.read_text()) if EXCLUSIONS_PATH.exists() else {}
    # Remove excluded venues from discovery and retained data, including retry runs.
    old['bars']=[b for b in old['bars'] if b['id'] not in exclusions]
    found['bars']=[b for b in found['bars'] if b['id'] not in exclusions]
    overrides=json.loads((ROOT/'scraper/website_overrides.json').read_text())
    found['bars']=[{**b,'website':overrides.get(b['id'],b.get('website'))} for b in found['bars']]
    hints=scoped_hints(found['bars'], hints)
    hosts=Counter(host(b['website']) for b in found['bars'] if b['website'])
    prior={b['id']:b for b in old['bars']}
    selected=[{**b,'offers':prior.get(b['id'],{}).get('offers',[]),'pizzaMenu':prior.get(b['id'],{}).get('pizzaMenu',[])} for b in found['bars'] if b['website'] and (b['type'] in ('restaurant','fast_food') or is_pizza_venue(b)) and (hosts[host(b['website'])]==1 or b['id'] in hints)]
    if args.only:selected=[b for b in selected if re.search(args.only,b['name'],re.I)]
    if args.retry:selected=[b for b in selected if checks.get(b['id'],{}).get('status')!='prices_found']
    selected.sort(key=lambda b:(not is_pizza_venue(b),not bool(re.search(r'pizz|ital|napol|rosso|luigia|leone|lucia|molino|trattoria|ristorante',b['name'],re.I)),checks.get(b['id'],{}).get('checkedAt',''),b['name'].casefold()))
    if args.limit:selected=selected[:args.limit]
    print(f'{len(found["bars"])} locations; crawling {len(selected)} eligible websites',flush=True)
    fetcher=ArchiveFetcher(args.archive_dir) if args.archive_dir else AuditFetcher(CACHE_DIR/'pizza')
    output=dict(prior)
    # Publish known pizzerias even when they lack a website or a scoped menu.
    for b in found['bars']:
        if is_pizza_venue(b):
            output[b['id']] = {**b, **prior.get(b['id'], {}), 'cuisine': b.get('cuisine', [])}
            if b['id'] not in prior:
                output[b['id']]['scrapeStatus'] = 'pending' if b['website'] else 'no_website'
    def flush():
        save(DATA,{'generatedAt':now(),'discoveredAt':found.get('discoveredAt',now()),'attribution':found.get('attribution','© OpenStreetMap contributors, ODbL 1.0'),'bars':sorted(output.values(),key=lambda b:b['name'].casefold())})
        save(CHECKS,checks)
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        tasks=[pool.submit(crawl,b,fetcher,hints,args.max_pages,reviews,ai,args.ai_max_documents) for b in selected]
        for i,task in enumerate(as_completed(tasks),1):
            b,check=task.result();checks[b['id']]=check
            if b['offers'] or b['pizzaMenu'] or b['id'] in output or is_pizza_venue(b):output[b['id']]=b
            print(f'[{i}/{len(tasks)}] {b["name"]}: {b["scrapeStatus"]} '+str([o['priceChf'] for o in b['offers']])+f'; {len(b["pizzaMenu"])} other pizzas',flush=True)
            if i%20==0:
                flush()
                if ai:save(CACHE_DIR/'pizza-ai-report.json',ai.report(completed=False))
    flush()
    if ai:
        report=ai.report();save(CACHE_DIR/'pizza-ai-report.json',report)
        print('Pizza AI report: '+json.dumps(report),flush=True)
    print(f'{sum(bool(b["offers"]) for b in output.values())} venues with verified-source Margherita prices',flush=True)
    print(f'{sum(len(b.get("pizzaMenu", [])) for b in output.values())} additional pizza prices',flush=True)


if __name__=='__main__':main()
