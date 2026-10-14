"""Conservative price extraction: require a named beer, explicit size and price.

Ambiguous tables are intentionally skipped rather than inventing prices. This
extractor does not OCR images or infer column alignment in broken PDF text.
"""
import re

BEER = re.compile(r'\b(bier|beer|lager|pils(?:ner)?|ipa|pale ale|stout|porter|weizen|weissbier|weißbier|helles|quöllfrisch|feldschlösschen|calanda|turbinenbräu|chopfab|heineken|guinness|erdinger|schützengarten|appenzeller|valaisanne|braufrisch|eichhof|amber|hofbräu|amboss|moretti|poretti|corona|schneider|grimbergen|sonnwendlig|lokalbier|schiffbrau|adler panix)\b', re.I)
SIZE = re.compile(r'(?<![\d.])(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l)\b', re.I)
PRICE = re.compile(r'(?:CHF\s*)?(\d{1,2}[.,]\d{1,2}|\d{1,2}\.\s*[–—-])(?:\s*(?:CHF|Fr\.?))?', re.I)

def extract_offers(text, source_url, observed_at, *, continuations=False):
    offers = []
    seen = set()
    # Preserve line boundaries. Joining unrelated menu rows risks wrong prices.
    lines = [re.sub(r'\s+', ' ', line).strip().lstrip('\ufeff') for line in text.splitlines()]
    previous_name = None
    previous_evidence = None
    blank_count = 0
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count > 1:
                previous_name = None
            continue
        blank_count = 0
        evidence = line
        # PDF rows often print a product once and the second size on the next line.
        # Only an immediately adjacent explicit size/price (optionally prefixed by
        # a parenthetical product description) may inherit that product name.
        continuation = re.fullmatch(r'(?:\([^)]{1,65}\)\s*)?(\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l)\s+(?:CHF\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?(?:\s*CHF)?)', line, re.I)
        if continuations and previous_name and continuation:
            line = previous_name + ' ' + continuation[1]
            evidence = previous_evidence + ' / ' + evidence
        previous_name = None
        if len(line) > 350 or not BEER.search(line):
            continue
        if re.search(r'\b(happy\s*hour|ab\s+\d|from\s+\d|pitcher|tower|pack|dose[n]?pack|[246]x)\b', line, re.I):
            continue
        sizes = list(SIZE.finditer(line))
        if not sizes:
            continue
        name = line[:sizes[0].start()].strip(' |:–—-')
        # Explicit parallel size/price lists, e.g. Lager 3dl / 5dl 5.00 / 7.50.
        if len(sizes)>1 and all(re.fullmatch(r'[\s/|]+',line[a.end():b.start()]) for a,b in zip(sizes,sizes[1:])):
            tail=line[sizes[-1].end():].strip()
            parts=re.split(r'\s*[/|]\s*',tail)
            if len(parts)==len(sizes) and all(re.fullmatch(r'(?:CHF\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?',p) for p in parts):
                line=name+' '+' | '.join(s[0]+' '+p for s,p in zip(sizes,parts))
                sizes=list(SIZE.finditer(line))
        # Match the beer name itself, not a different product elsewhere in the row.
        if not BEER.search(name) or re.search(r'ginger|tonic|cocktail|mule|martini|bourbon|grenadine|ananassaft|kafi',name,re.I):
            continue
        # Multi-column PDFs can merge a wine/cocktail price into the beer name.
        without_abv=re.sub(r'<?\s*\d+(?:[.,]\d+)?\s*%\s*(?:vol)?', '', name, flags=re.I)
        if PRICE.search(without_abv) or re.search(r'\d\s*[|/]\s*\d',without_abv):
            continue
        abvs=re.findall(r'(\d+(?:[.,]\d+)?)\s*%',name)
        if any(float(v.replace(',','.'))>16 for v in abvs):
            continue
        # Multiple sizes are valid only when separated solely by prices/separators.
        segments=[line[s.end():sizes[i+1].start() if i+1<len(sizes) else len(line)] for i,s in enumerate(sizes)]
        cleaned=[re.sub(r'CHF|Fr\.?','',seg,flags=re.I) for seg in segments]
        if any(re.search(r'[^\d\s.,|:/;–—-]',seg) for seg in cleaned):
            continue
        for i, size in enumerate(sizes):
            ml = round(float(size[1].replace(',', '.')) * {'l':1000, 'dl':100, 'cl':10, 'ml':1}[size[2].lower()])
            if not 100 <= ml <= 1000:
                continue
            tail = line[size.end():sizes[i+1].start() if i+1 < len(sizes) else len(line)]
            # A single price directly follows the size. Percentages are never prices.
            match = re.match(r'^\s*(?:[|:/–—-]\s*)?(?:CHF\s*)?(\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?)(?:\s*(?:CHF|Fr\.?))?(?![\d%])', tail, re.I)
            if not match or '%' in tail[:match.end()+2]:
                continue
            raw = re.sub(r'[–—-]', '0', match[1]).replace(' ', '').replace(',', '.')
            price = float(raw)
            if not 2 <= price <= 25:
                continue
            # Multiple unrelated numeric fields in one segment are ambiguous.
            if re.search(r'\d',tail[match.end():]):
                continue
            clean_name=re.sub(r'\s*(?:alc\s*)?\(?<?\s*\d+(?:[.,]\d+)?\s*%\s*(?:vol\.?)?\)?', '', name, flags=re.I).strip()
            if not clean_name or len(clean_name)>80:
                continue
            key = (clean_name.casefold(), ml, price)
            if key in seen:
                continue
            seen.add(key)
            offers.append({'name':clean_name, 'volumeMl':ml, 'priceChf':price,
                'sourceUrl':source_url, 'observedAt':observed_at,
                'confidence':'automatic', 'evidence':evidence[:350],
                'alcoholFree':bool(re.search(r'alkoholfrei|alcohol.?free|non.alcoholic|sans alcool|ohne alk',name,re.I)) or bool(abvs and all(float(v.replace(',','.'))<=.5 for v in abvs))})
            if len(sizes)==1:
                # Keep ABV metadata for the next portion's alcohol-free flag.
                previous_name=name
                previous_evidence=evidence
    return offers
