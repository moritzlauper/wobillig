"""Conservative price extraction: named beers with size and price, or explicitly
priced Stangen whose missing capacity remains unknown.

Ambiguous tables are intentionally skipped rather than inventing prices. This
extractor does not OCR images or infer column alignment in broken PDF text.
"""
import re
from scraper.beer_type import explicit_type, section_type

BEER = re.compile(r'\b(biere?|beers?|lager(?:bier)?|pils(?:e?ner)?|ipa|pale ale|stout|porter|weizen(?:bier)?|weissbier|weißbier|helles|quöllfrisch|feldschlösschen|calanda|turbinenbräu|chopfab|heineken|guinness|erdinger|schützengarten|appenzeller|valaisanne|braufrisch|eichhof|amber|hofbräu|amboss|moretti|poretti|corona|schneider|grimbergen|sonnwendlig|lokalbier|schiffbrau|adler panix|hürlimann|augustiner|san miguel|super bock|1664 blanc|peroni|asahi|sapporo|red stripe|singha|chang|tiger|brooklyn|paulaner|falken|warsteiner|hoegaarden|franziskaner|budweiser|bitburger|jever|brew.?dog|tegernseer?|maisel|kilkenny|fullers|five lamps|hop house|1664)\b', re.I)
SIZE = re.compile(r'(?<![\d.])(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l)\b', re.I)
PRICE = re.compile(r'(?:(?:CHF|Fr\.?)\s*)?(\d{1,2}[.,]\d{1,2}|\d{1,2}\.\s*[–—-])(?:\s*(?:CHF|Fr\.?))?', re.I)
STANGE = re.compile(r'\bstange\b', re.I)
# A named beer serving is also an explicit product, even without a brand.
BEER = re.compile(BEER.pattern + r'|\b(?:stange|boxer|haldengut|einsiedler)\b', re.I)

def extract_stange_prefix(text, source_url, observed_at):
    """A complete, explicitly sized Stange may precede a second PDF column.

    Never cross a product or missing price: the first size must be immediately
    followed by its own price, and the prefix still passes normal validation.
    """
    size=SIZE.search(text)
    if not size:
        return []
    tail=text[size.end():]
    price=re.match(r'\s*(?:«Stange»\s*)?(?:(?:CHF|Fr\.?)\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?(?:\s*CHF)?(?=\s+[A-Za-zÄÖÜäöü]|$)',tail,re.I)
    if not price:
        return []
    prefix=text[:size.end()+price.end()]
    if not STANGE.search(prefix):
        return []
    offers=extract_offers(prefix,source_url,observed_at)
    for offer in offers:
        offer['evidence']=text[:350]
    return offers

def extract_offers(text, source_url, observed_at, *, continuations=False):
    offers = []
    seen = set()
    # Preserve line boundaries. Joining unrelated menu rows risks wrong prices.
    lines = [re.sub(r'\s+', ' ', line).strip().lstrip('\ufeff') for line in text.splitlines()]
    previous_name = None
    previous_evidence = None
    blank_count = 0
    beer_type = 'unknown'
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count > 1:
                previous_name = None
            continue
        blank_count = 0
        heading_type=section_type(line)
        if heading_type is not None:
            beer_type=heading_type
        evidence = line
        line = re.sub(r'(\d)\s*([.,])\s*(\d)',r'\1\2\3',line)
        line = re.sub(r'((?:ml|cl|dl|l)\b)\.(?=\s)',r'\1',line,flags=re.I)
        line = re.sub(r'((?:ml|cl|dl|l)\b)\s+(?:bügelflasche|flasche|bottle)\b',r'\1',line,flags=re.I)
        # Some menus print price(s) before explicitly stated portion(s).
        # Accept only a complete row with equal, slash-separated list lengths.
        amount=r'(?:(?:CHF|Fr\.?)\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?'
        reverse=re.fullmatch(r'(.+?)\s+('+amount+r'(?:\s*/\s*'+amount+r')*)\s+('+SIZE.pattern+r'(?:\s*/\s*'+SIZE.pattern+r')*)',line,re.I)
        if reverse:
            portions=[s[0] for s in SIZE.finditer(reverse[3])]
            prices=re.split(r'\s*/\s*',reverse[2])
            if len(portions)==len(prices) and BEER.search(reverse[1]):
                line=reverse[1]+' '+' | '.join(size+' '+price for size,price in zip(portions,prices))
        # Printed brackets/leader dots are layout, not additional product data.
        line = re.sub(r'\((\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l))\)', r'\1', line, flags=re.I)
        line = re.sub(r'((?:ml|cl|dl|l)\b)\s*\((?:flasche|stange|offen|bottle)\)', r'\1', line, flags=re.I)
        line = re.sub(r'((?:ml|cl|dl|l)\b)\s*«(?:stange|herrgöttli|es grosses)»', r'\1', line, flags=re.I)
        line = re.sub(r'((?:ml|cl|dl|l)\b)\s+offen\b', r'\1', line, flags=re.I)
        line = re.sub(r'(?:\.\s*){3,}', ' ', line)
        # Explicit alternate notations, never infer a missing unit or ABV.
        line = re.sub(r'(\d+[.,])\s+(\d+)\s*%', r'\1\2%', line)
        line = re.sub(r'(\d+)\.\s*%', r'\1%', line)
        line = re.sub(r'(\d+(?:[.,]\d+)?)\s+vol\.?\s*-?\s*%', r'\1%', line, flags=re.I)
        shared = re.search(r'(\d+(?:[.,]\d+)?)\s*/\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l)\b', line, re.I)
        if shared and not SIZE.search(line[:shared.start()]):
            line = line[:shared.start()] + f'{shared[1]}{shared[3]} / {shared[2]}{shared[3]}' + line[shared.end():]
        # Menus can place the alcohol declaration between size and price.
        trailing_abv = re.search(r'(?<=\s)(<?\s*\d+(?:[.,]\d*)?\s*%\s*(?:vol\.?)?|alkoholfrei)(?=\s|$)', line, re.I)
        first_size = SIZE.search(line)
        if trailing_abv and first_size and trailing_abv.start() > first_size.start():
            metadata = trailing_abv[0]
            line = line[:trailing_abv.start()] + line[trailing_abv.end():]
            line = line[:first_size.start()] + metadata + ' ' + line[first_size.start():]
        # PDF rows often print a product once and the second size on the next line.
        # Only an immediately adjacent explicit size/price (optionally prefixed by
        # a parenthetical product description) may inherit that product name.
        continuation = re.fullmatch(r'(?:\([^)]{1,65}\)\s*)?(\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l)\s+(?:(?:CHF|Fr\.?)\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?(?:\s*CHF)?)', line, re.I)
        if continuations and previous_name and continuation:
            line = previous_name + ' ' + continuation[1]
            evidence = previous_evidence + ' / ' + evidence
        previous_name = None
        if len(line) > 350 or not BEER.search(line):
            continue
        if re.search(r'\b(happy\s*hour|ab\s+\d|from\s+\d|pitcher|tower|pack|dose[n]?pack|degu|degustation|tasting|take[ -]?away|[246]x)\b', line, re.I):
            continue
        sizes = list(SIZE.finditer(line))
        if not sizes:
            # A menu can price a "Stange" without specifying its capacity.
            # Reuse the normal product/price validation with a parsing-only
            # sentinel, then discard that volume: never publish an assumed 3 dl.
            match=re.fullmatch(r'(.*?\bstange\b.*?)\s+((?:(?:CHF|Fr\.?)\s*)?\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?(?:\s*(?:CHF|Fr\.?))?)',line,re.I)
            if (match and not re.search(r'\bgross\w*|\blarge\b|\bbig\b',match[1],re.I) and
                (BEER.search(STANGE.sub('',match[1])) or re.fullmatch(r'stange(?:\s*[/|]\s*(?:stange\s*)?panach[eé])?',match[1],re.I))):
                for offer in extract_offers(match[1]+' 100ml '+match[2],source_url,observed_at):
                    key=(offer['name'].casefold(),None,offer['priceChf'])
                    if key not in seen:
                        seen.add(key)
                        offers.append({**offer,'volumeMl':None,'serving':'stange','beerType':explicit_type(evidence) or beer_type,'evidence':evidence[:350]})
            continue
        name = line[:sizes[0].start()].strip(' |:–—-')
        if re.search(r'\bspezi\b|orangensaft|apfelsaft|lemonade|limonade',name,re.I):
            continue
        if re.search(r'\bappenzeller\b.*\b(?:laut|still)\b',name,re.I):
            continue
        # Explicit parallel size/price lists, e.g. Lager 3dl / 5dl 5.00 / 7.50.
        if len(sizes)>1 and all(re.fullmatch(r'[\s/|]+',line[a.end():b.start()]) for a,b in zip(sizes,sizes[1:])):
            tail=line[sizes[-1].end():].strip()
            parts=re.split(r'\s*[/|]\s*',tail)
            if len(parts)==len(sizes) and all(re.fullmatch(r'(?:(?:CHF|Fr\.?)\s*)?\d{1,2}(?:[.,]\d{1,2}|\.[–—-])?',p) for p in parts):
                line=name+' '+' | '.join(s[0]+' '+p for s,p in zip(sizes,parts))
                sizes=list(SIZE.finditer(line))
        # Match the beer name itself, not a different product elsewhere in the row.
        if not BEER.search(name) or re.search(r'ginger|tonic|cocktail|mule|martini|bourbon|grenadine|ananassaft|kafi|mineral|laut\s*/\s*still|still\s*/\s*laut|picon|aperitivo|spritz|bierbrand|bierschnaps|sorbet|suppe|sauce|risotto|salate|\bCHF\b|mit\s*/\s*ohne',name,re.I):
            continue
        # Multi-column PDFs can merge a wine/cocktail price into the beer name.
        without_abv=re.sub(r'<?\s*\d+(?:[.,]\d+)?\s*%\s*(?:vol)?', '', name, flags=re.I)
        without_abv=re.sub(r'\b0[.,]0\b', '', without_abv)
        if re.search(r'\s\d{1,2}\s*$',without_abv) and not re.search(r'\bPaul\s+\d{2}\s*$',without_abv,re.I):
            continue
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
            match = re.match(r'^\s*(?:[|:/–—-]\s*)?(?:(?:CHF|Fr\.?)\s*)?(\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?)(?:\s*(?:CHF|Fr\.?))?(?![\d%])', tail, re.I)
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
            kind=explicit_type(evidence) or beer_type
            key = (clean_name.casefold(), ml, price, kind)
            if key in seen:
                continue
            seen.add(key)
            offers.append({'name':clean_name, 'volumeMl':ml, 'priceChf':price,
                'beerType':kind,
                'sourceUrl':source_url, 'observedAt':observed_at,
                'confidence':'automatic', 'evidence':evidence[:350],
                'alcoholFree':bool(re.search(r'alkohol\s*frei|alcohol.?free|non[ .-]*alcohol(?:ic)?\b|sans alcool|ohne alk|\bzero\b|\b0[.,]0\b',name,re.I)) or bool(abvs and all(float(v.replace(',','.'))<=.5 for v in abvs))})
            if STANGE.search(clean_name) and not re.search(r'\bgross\w*|\blarge\b|\bbig\b',clean_name,re.I):
                offers[-1]['serving']='stange'
            if len(sizes)==1:
                # Keep ABV metadata for the next portion's alcohol-free flag.
                previous_name=name
                previous_evidence=evidence
    classified={(o['name'].casefold(),o['volumeMl'],o['priceChf']) for o in offers if o['beerType']!='unknown'}
    return [o for o in offers if o['beerType']!='unknown' or (o['name'].casefold(),o['volumeMl'],o['priceChf']) not in classified]
