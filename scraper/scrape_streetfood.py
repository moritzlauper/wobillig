"""Independent city crawls for Döner and Falafel; --category selects the dataset.

Example: WOBILLIG_CITY=bern python -m scraper.scrape_streetfood \
    --category falafel --discover --limit 0 --max-pages 120
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlparse, parse_qs, unquote

from bs4 import BeautifulSoup
from scraper.cities import DATA_DIR, STATE_DIR, CACHE_DIR, ROOT, venue_query
from scraper.scrape import discover, now
from scraper.enrich import AuditFetcher, host
from scraper.scrape_coffee import ArchiveFetcher, save
from scraper.scrape_pizza import scoped_hints
from scraper.pizza import structured_menu_links, orderstar_menu_url
from scraper.pdf_extract import pdf_links
from scraper.streetfood import LABELS, food_html, food_pdf, food_image, food_orderstar

QUERY = venue_query('restaurant|fast_food|cafe|bar|pub')
HINTS_PATH = ROOT / 'scraper/streetfood_menu_urls.json'
DOCUMENT = re.compile(r'\.(?:pdf|jpe?g|png|webp)$', re.I)
RELEVANT = re.compile(r'd[oö]ner|doener|keba[bp]|falafel|d[uü]r[uü]m|menu|menü|karte|speise|food|essen|take.?away|bestell|order', re.I)


def paths(category):
    if category not in LABELS:
        raise ValueError('Unknown street-food category')
    return DATA_DIR / f'{category}.json', STATE_DIR / f'{category}_checks.json'


def is_food_venue(bar, category):
    cuisine = bar.get('cuisine', [])
    cuisine = cuisine.split(';') if isinstance(cuisine, str) else cuisine
    pattern = r'falafel|libanes|lebanes|orient|vegetari' if category == 'falafel' else r'd[oö]ner|doener|keba[bp]|t[uü]rk|turkish'
    return bool(re.search(pattern, ' '.join(cuisine) + ' ' + bar['name'], re.I)
                or any(o.get('foodType') == category for o in bar.get('offers', [])))


def skip_source(url):
    parsed = urlparse(url)
    if parsed.scheme not in ('https', 'http'):
        return True
    if any(re.search(r'cart|wishlist|checkout|nonce|action|remove|delete', key, re.I) for key in parse_qs(parsed.query)):
        return True
    return bool(re.search(r'/(?:cart|warenkorb|checkout|kasse|mein-konto|my-account|login|logout)(?:/|$)', parsed.path, re.I))


def menu_links(body, url):
    soup = BeautifulSoup(body, 'html.parser')
    result = structured_menu_links(body, url)
    for node in soup.select('a[href],iframe[src],embed[src],object[data],img'):
        value = node.get('href') or node.get('data-src') or node.get('data-lazy-src') or node.get('src') or node.get('data')
        if not value:
            continue
        target = urljoin(url, value).split('#')[0]
        if node.name == 'img' and host(target) == 'static.wixstatic.com' and '/v1/' in target:
            target = target.split('/v1/')[0]
        path = unquote(urlparse(target).path)
        label = node.get_text(' ', strip=True) + ' ' + node.get('alt', '') + ' ' + path
        if node.name == 'img' and re.search(r'logo|icon|banner|avatar|favicon|\.svg$', label, re.I):
            continue
        relevant = RELEVANT.search(label) or path.lower().endswith('.pdf') or (node.name == 'img' and RELEVANT.search(urlparse(url).path))
        if relevant and (host(target) == host(url) or DOCUMENT.search(path)):
            result.append(target)
    return list(dict.fromkeys(u for u in result if not skip_source(u)))


def crawl(bar, fetcher, hints, max_pages, category):
    stamp = now()
    queue = list(hints.get(bar['id'], [])) + [bar['website']]
    allowed = set(hints.get(bar['id'], []))
    online_feeds = set()
    visited, successful_sources, errors, offers = set(), set(), [], []
    while queue and len(visited) < max_pages:
        url = queue.pop(0)
        if not url or url in visited or skip_source(url):
            continue
        visited.add(url)
        try:
            final, kind, body = fetcher.get(url)
            if skip_source(final):
                continue
            if isinstance(fetcher, ArchiveFetcher):
                stamp = fetcher.docs[final]['stamp']
            if 'pdf' in kind or urlparse(final).path.lower().endswith('.pdf'):
                found = food_pdf(body, final, stamp, category)
                links = [u for u in pdf_links(body) if DOCUMENT.search(urlparse(u).path)]
            elif 'html' in kind:
                found = food_html(body, final, stamp, category)
                links = menu_links(body, final)
                feed = orderstar_menu_url(body, final)
                if feed:
                    links.append(feed); online_feeds.add(feed)
                    # A branch-specific page must explicitly own its menu;
                    # a chain-wide root feed is not branch-specific evidence.
                    if url in allowed and urlparse(url).path in ('', '/'):
                        allowed.add(feed)
                if url in allowed:
                    allowed.update(structured_menu_links(body, final))
                    allowed.update(u for u in links if DOCUMENT.search(urlparse(u).path))
            elif kind.startswith('image/'):
                found, links = food_image(body, final, stamp, category), []
            elif url in online_feeds and 'json' in kind:
                found, links = food_orderstar(body, final, stamp, category), []
            else:
                continue
            if not hints.get(bar['id']) or url in allowed:
                offers.extend(found)
                successful_sources.update([url, final])
            if hints.get(bar['id']):
                links = [u for u in links if u in allowed]
            queue = list(dict.fromkeys(u for u in links + queue if u not in visited and not skip_source(u)))
            queue.sort(key=lambda u: (not bool(re.search(r'd[oö]ner|keba[bp]|falafel', u, re.I)), not bool(DOCUMENT.search(urlparse(u).path))))
        except Exception as error:
            errors.append({'url': url, 'error': str(error)[:150] if isinstance(error, ValueError) else type(error).__name__})
    groups = defaultdict(list)
    for offer in offers:
        groups[(offer['portionType'], offer['meatType'])].append(offer)
    result, ambiguous = [], False
    for group in groups.values():
        onsite = [o for o in group if o.get('priceContext') != 'online_menu']
        candidates = onsite or group
        prices = {o['priceChf']: o for o in candidates}
        if len(prices) == 1:
            result.extend(prices.values())
        else:
            ambiguous = True
    # Failed sources may retain an old observation with its original timestamp,
    # but a successfully rechecked source cannot keep a removed or changed price.
    if errors:
        for old in bar.get('offers', []):
            key = (old.get('portionType'), old.get('meatType'))
            if old.get('foodType') == category and old['sourceUrl'] not in successful_sources and key not in groups:
                result.append(old)
    status = 'ambiguous_prices' if ambiguous else 'prices_found' if result else 'partial' if successful_sources and errors else 'no_prices' if successful_sources else 'fetch_failed'
    return {**bar, 'offers': result, 'checkedAt': now(), 'scrapeStatus': status}, {
        'checkedAt': now(), 'status': status, 'visited': sorted(visited), 'errors': errors, 'candidates': offers,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--category', choices=LABELS, required=True)
    parser.add_argument('--discover', action='store_true')
    parser.add_argument('--venues-file', type=Path)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--max-pages', type=int, default=50)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--archive-dir', action='append', default=[])
    parser.add_argument('--only', help='Venue name regex')
    args = parser.parse_args()
    if args.max_pages < 1 or args.limit < 0:
        parser.error('max-pages must be positive and limit non-negative')
    data_path, checks_path = paths(args.category)
    old = json.loads(data_path.read_text()) if data_path.exists() else {'bars': []}
    if args.venues_file:
        found = json.loads(args.venues_file.read_text())
    elif args.discover or not old['bars']:
        found = discover(old, query=QUERY)
        save(CACHE_DIR / f'{args.category}-venues.json', found)
    else:
        found = old
    checks = json.loads(checks_path.read_text()) if checks_path.exists() else {}
    overrides = json.loads((ROOT / 'scraper/website_overrides.json').read_text())
    prior = {b['id']: b for b in old['bars']}
    bars = [{**b, 'website': overrides.get(b['id'], b.get('website')), 'offers': prior.get(b['id'], {}).get('offers', [])} for b in found['bars']]
    hints = scoped_hints(bars, json.loads(HINTS_PATH.read_text()) if HINTS_PATH.exists() else {})
    hosts = Counter(host(b['website']) for b in bars if b.get('website'))
    selected = [b for b in bars if b.get('website') and (b['type'] in ('restaurant', 'fast_food') or is_food_venue(b, args.category))
                and (hosts[host(b['website'])] == 1 or b['id'] in hints)]
    if args.only:
        selected = [b for b in selected if re.search(args.only, b['name'], re.I)]
    selected.sort(key=lambda b: (not is_food_venue(b, args.category), checks.get(b['id'], {}).get('checkedAt', ''), b['name'].casefold()))
    if args.limit:
        selected = selected[:args.limit]
    output = dict(prior)
    for bar in bars:
        if is_food_venue(bar, args.category):
            output[bar['id']] = bar
    fetcher = ArchiveFetcher(args.archive_dir) if args.archive_dir else AuditFetcher(CACHE_DIR / args.category)
    def flush():
        save(data_path, {'generatedAt': now(), 'discoveredAt': found.get('discoveredAt', now()),
                         'attribution': found.get('attribution', '© OpenStreetMap contributors, ODbL 1.0'),
                         'bars': sorted(output.values(), key=lambda b: b['name'].casefold())})
        save(checks_path, checks)
    print(f'{args.category}: {len(bars)} locations; crawling {len(selected)} eligible websites', flush=True)
    flush()
    with ThreadPoolExecutor(max_workers=max(1, min(8, args.workers))) as pool:
        tasks = [pool.submit(crawl, bar, fetcher, hints, args.max_pages, args.category) for bar in selected]
        for index, task in enumerate(as_completed(tasks), 1):
            bar, check = task.result()
            checks[bar['id']] = check
            if bar['offers'] or bar['id'] in output:
                output[bar['id']] = bar
            print(f'[{index}/{len(tasks)}] {bar["name"]}: {bar["scrapeStatus"]} {[o["priceChf"] for o in bar["offers"]]}', flush=True)
            if index % 10 == 0:
                flush()
    flush()


if __name__ == '__main__':
    main()
