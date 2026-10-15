"""Search additional city restaurants/cafes; publish only real beer-price hits.

python -m scraper.enrich --limit 200
Repeated limited runs rotate through least recently checked candidates. Shared
chain websites require a venue-specific menu hint to avoid mixing branches.
"""
from scraper.cities import STATE_DIR, CACHE_DIR, venue_query
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

from scraper.scrape import DATA, ROOT, Fetcher, discover, now, scrape_bar, write

QUERY = venue_query('restaurant|cafe')
STATE = STATE_DIR / 'discovery_checks.json'


def host(url):
    return (urlparse(url or '').hostname or '').removeprefix('www.')


def candidates(found, existing, hints, checks):
    known={b['id'] for b in existing}
    unique={b['id']:b for b in existing+found}
    hosts=Counter(host(b['website']) for b in unique.values() if b['website'])
    result=[]
    for b in found:
        if b['id'] in known or not b['website']:
            continue
        if hosts[host(b['website'])] > 1 and b['id'] not in hints:
            continue
        if any(b['name'].casefold()==a['name'].casefold() and abs(b['lat']-a['lat'])<.0005 and abs(b['lon']-a['lon'])<.0007 for a in existing):
            continue
        result.append(b)
    return sorted(result,key=lambda b:(checks.get(b['id'],{}).get('checkedAt',''),b['name'].casefold()))


class AuditFetcher(Fetcher):
    def __init__(self, directory=None):
        super().__init__()
        self.directory=Path(directory) if directory else None
        if self.directory:
            self.directory.mkdir(parents=True,exist_ok=True)

    def get(self,url):
        try:
            final,kind,body=super().get(url)
        except Exception as exc:
            if self.directory:
                key=hashlib.sha256(url.encode()).hexdigest()[:20]
                (self.directory/(key+'.error')).write_text(f'{type(exc).__name__}: {exc}')
            raise
        if self.directory:
            key=hashlib.sha256(final.encode()).hexdigest()[:20]
            (self.directory/(key+'.body')).write_bytes(body)
            (self.directory/(key+'.json')).write_text(json.dumps({'url':final,'requestedUrl':url,'kind':kind,'observedAt':now()}))
        return final,kind,body


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--osm-file')
    parser.add_argument('--limit',type=int,default=200,help='0 checks all eligible candidates')
    parser.add_argument('--workers',type=int,default=8)
    parser.add_argument('--max-pages',type=int,default=5)
    parser.add_argument('--audit-dir')
    parser.add_argument('--review-only',action='store_true',help='Save discoveries for inspection without changing the published data')
    parser.add_argument('--retry-failed',action='store_true',help='Retry candidates whose last crawl failed or was partial')
    args=parser.parse_args()
    dataset=json.loads(DATA.read_text())
    found=discover({},args.osm_file,query=QUERY)['bars']
    hints=json.loads((ROOT/'scraper/menu_urls.json').read_text())
    checks=json.loads(STATE.read_text()) if STATE.exists() else {}
    selected=candidates(found,dataset['bars'],hints,checks)
    if args.retry_failed:
        selected=[b for b in selected if checks.get(b['id'],{}).get('status') in ('fetch_failed','partial')]
    print(f'{len(found)} restaurants/cafes; {len(selected)} eligible new websites',flush=True)
    if args.limit:
        selected=selected[:args.limit]
    fetcher=AuditFetcher(args.audit_dir)
    review_path=(Path(args.audit_dir) if args.audit_dir else CACHE_DIR)/'discoveries.json'
    additions=json.loads(review_path.read_text()) if args.review_only and review_path.exists() else []
    def save():
        STATE.parent.mkdir(parents=True, exist_ok=True)
        temporary=STATE.with_suffix('.tmp')
        temporary.write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
        temporary.replace(STATE)
        if args.review_only:
            unique={b['id']:b for b in additions}
            review_path.write_text(json.dumps(list(unique.values()),ensure_ascii=False,indent=2)+'\n')
        elif additions:
            dataset['bars']=sorted(dataset['bars']+additions,key=lambda b:b['name'].casefold())
            dataset['generatedAt']=now();write(dataset);additions.clear()
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        tasks=[pool.submit(scrape_bar,b,fetcher,hints,args.max_pages) for b in selected]
        for i,task in enumerate(as_completed(tasks),1):
            b=task.result()
            checks[b['id']]={'checkedAt':b['checkedAt'],'status':b['scrapeStatus']}
            if b['offers']:
                additions.append(b)
            print(f"[{i}/{len(tasks)}] {b['name']}: {b['scrapeStatus']} ({len(b['offers'])} offers)",flush=True)
            if i%20==0:
                save()
    save()


if __name__=='__main__':
    main()
