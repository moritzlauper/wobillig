"""Discover and refresh coffee prices independently of the beer dataset.

python -m scraper.scrape_coffee --discover --limit 200
Use --limit 0 for all candidates. Archived HTTP documents can be reused offline;
every offer retains the original fetch date, never the replay date.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
import json
from pathlib import Path
from urllib.parse import urlparse
from scraper.scrape import ROOT,Fetcher,discover,scrape_bar,now
from scraper.enrich import QUERY,candidates,host

DATA=ROOT/'public/data/coffee.json'
CHECKS=ROOT/'scraper/coffee_checks.json'


class ArchiveFetcher:
    def __init__(self,folders):
        self.docs={};self.alias={}
        for folder in folders:
            for path in Path(folder).glob('*.json'):
                try: record=json.loads(path.read_text())
                except (ValueError,OSError):continue
                if not isinstance(record,dict):continue
                entries=record.get('docs',[record])
                for d in entries:
                    if not d.get('kind') or not d.get('url'):continue
                    file=path.with_suffix('.body') if 'key' not in d else path.parent/(d['key']+('.pdf' if d.get('pdf') else '.html'))
                    if not file.exists():continue
                    stamp=d.get('observedAt') or datetime.fromtimestamp(file.stat().st_mtime,timezone.utc).isoformat()
                    self.docs[d['url']]={**d,'file':file,'stamp':stamp}
                    self.alias[d.get('requestedUrl',d['url'])]=d['url']
        self.normalized={self.normalize(u):u for u in self.docs}

    @staticmethod
    def normalize(url):
        p=urlparse(url)
        return host(url),p.path.rstrip('/'),p.query

    def get(self,url):
        final=self.alias.get(url,self.normalized.get(self.normalize(url),url))
        if final not in self.docs and urlparse(url).path in ('','/'):
            pages=sorted((u for u,d in self.docs.items() if host(u)==host(url) and 'html' in d['kind']),key=len)
            if pages:final=pages[0]
        if final not in self.docs:raise ValueError('not_in_archive')
        d=self.docs[final]
        return final,d['kind'],d['file'].read_bytes()


def save(path,value):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discover',action='store_true')
    parser.add_argument('--osm-file')
    parser.add_argument('--limit',type=int,default=200,help='Additional candidates; known coffee venues are always refreshed')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--max-pages',type=int,default=10,help='Maximum linked documents per venue')
    parser.add_argument('--archive-dir',action='append',default=[])
    args=parser.parse_args()
    beer=json.loads((ROOT/'public/data/bars.json').read_text())
    previous=json.loads(DATA.read_text()) if DATA.exists() else {'bars':[]}
    old={b['id']:b for b in previous['bars']}
    checks=json.loads(CHECKS.read_text()) if CHECKS.exists() else {}
    hints=json.loads((ROOT/'scraper/menu_urls.json').read_text())
    hints.update(json.loads((ROOT/'scraper/coffee_menu_urls.json').read_text()))
    discovered=discover(previous,args.osm_file,query=QUERY) if args.discover or args.osm_file or not old else previous
    all_bars={b['id']:b for b in beer['bars']+discovered['bars']}
    eligible=candidates(list(all_bars.values()),[],hints,checks)
    known=[all_bars.get(id,b) for id,b in old.items()]
    fresh=[b for b in eligible if b['id'] not in old]
    if args.limit:fresh=fresh[:args.limit]
    selected=[{**b,'offers':old.get(b['id'],{}).get('offers',[])} for b in known+fresh]
    fetcher=ArchiveFetcher(args.archive_dir) if args.archive_dir else Fetcher()
    output=dict(old)
    def flush():
        dataset={'generatedAt':now(),'discoveredAt':discovered['discoveredAt'],'attribution':beer['attribution'],'bars':sorted(output.values(),key=lambda b:b['name'].casefold())}
        save(DATA,dataset);save(CHECKS,checks)
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        tasks=[pool.submit(scrape_bar,b,fetcher,hints,args.max_pages,'coffee') for b in selected]
        for i,task in enumerate(as_completed(tasks),1):
            b=task.result()
            if args.archive_dir:
                for o in b['offers']:
                    if o['sourceUrl'] in fetcher.docs:o['observedAt']=fetcher.docs[o['sourceUrl']]['stamp']
            checks[b['id']]={'checkedAt':b['checkedAt'],'status':b['scrapeStatus']}
            if b['offers'] or b['id'] in old:output[b['id']]=b
            print(f"[{i}/{len(tasks)}] {b['name']}: {len(b['offers'])} coffees",flush=True)
            if i%25==0:flush()
    flush()
    print(f"Saved {len(output)} coffee venues with {sum(len(b['offers']) for b in output.values())} offers",flush=True)


if __name__=='__main__':main()
