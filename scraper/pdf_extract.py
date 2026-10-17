"""Read menu columns and explicit beer-table size headers without guessing sizes."""
from io import BytesIO
import re
import pdfplumber
from scraper.extract import BEER, SIZE, extract_offers, extract_stange_prefix, beer_product
from scraper.beer_type import explicit_type, section_type, annotate

BEER_HEADING = re.compile(r'\b(?:biere?|beers?|flaschenbier[e]?|offenbier[e]?|draught|draft|bottled|by the bottle|bottles|vom fass)\b', re.I)
STOP_HEADING = re.compile(r'\b(?:wein[e]?|wine[s]?|soft|getränke|cocktails?|spirituosen|shots|aperitif|kaffee|coffee|tee|cider|most|säfte|spritz|gin|whisk\w*)\b', re.I)
NUMBER = r'\d{1,2}(?:[.,]\d{1,2}|[.][–—-])?'


def size_heading(text):
    """A product such as 'Amboss Weizen Bier 5dl' is NOT a size header."""
    words=re.findall(r'[a-zäöü]+',SIZE.sub('',text).casefold())
    allowed={'bier','biere','beers','beer','flaschen','flaschenbier','flaschenbiere','offenbier','offenbiere','vom','fass','frisch','gezapft','zapft','bottled','bottles','draft','draught','on','tap','alkoholfrei','alkoholfreie','alkoholfreies','alcohol','free','non','naturtrübe','naturtrüb','amber','hell','helle','weizen','weizenbiere','cl','chf'}
    allowed.update({'im','offenausschank','diverse'})
    return bool(words) and all(w in allowed for w in words)


def beer_name(name, heading):
    if re.search(r'^(?:alkoholfrei\w*\s+biere?|non[ .-]*alcoholic\s+beers?)\b',heading,re.I):
        return name + ' alkoholfrei'
    return name


def column_regions(page):
    """Split only at clear gutters with prose on BOTH sides, never price columns."""
    # Folded menus often have unequal panels plus an illustration. Find actual
    # empty vertical gutters before trying equal-width column boundaries.
    # Both sides must contain prose, so size/price columns stay with their names.
    def split(region, depth=0):
        items = region.extract_words()
        intervals = sorted((w['x0'], w['x1']) for w in items)
        gaps = []; end = region.bbox[0]
        for left, right in intervals:
            if left - end >= 20 and end > region.bbox[0]:
                gaps.append((left - end, (left + end) / 2))
            end = max(end, right)
        if depth < 5:
            for _, cut in sorted(gaps, reverse=True):
                sides = [[w for w in items if w['x1'] <= cut],
                         [w for w in items if w['x0'] >= cut]]
                if all(len({w['text'].casefold() for w in side
                            if re.search(r'[a-zäöü]{3}', w['text'], re.I)
                            and w['text'].casefold() not in {'vol.', 'chf', 'preis', 'inhalt', 'flasche'}}) >= 6 for side in sides):
                    x0, top, x1, bottom = region.bbox
                    return (split(region.crop((x0, top, cut, bottom), strict=False), depth + 1)
                            + split(region.crop((cut, top, x1, bottom), strict=False), depth + 1))
        return [region]
    regions = split(page)
    if len(regions) > 1:
        return regions
    words = page.extract_words()
    for count in (4, 3, 2):
        cuts = [page.width * i / count for i in range(1, count)]
        # A column cut must not bisect a word, including headings or descriptions.
        if any(any(w['x0'] < c < w['x1'] for w in words) for c in cuts):
            continue
        regions = []
        for left, right in zip([0] + cuts, cuts + [page.width]):
            contained = [w for w in words if left <= w['x0'] and w['x1'] <= right]
            prose = {w['text'].lower() for w in contained if w['top'] < page.height * .9 and re.search(r'[a-zäöü]{3}', w['text'], re.I)}
            prose -= {'vol.', 'chf', 'depot', 'preis', 'inhalt', 'flasche'}
            if len(prose) < 6:
                break
            regions.append(page.crop((left + page.bbox[0], page.bbox[1], right + page.bbox[0], page.bbox[3]), strict=False))
        if len(regions) == count:
            return regions
    return [page]


def aligned_table_lines(region):
    """Use printed x coordinates for sparse size columns (e.g. 33 / 50 cl)."""
    rows = []
    for word in sorted(region.extract_words(), key=lambda w: (w['top'], w['x0'])):
        if not rows or abs(word['top'] - rows[-1][0]['top']) > 4:
            rows.append([])
        rows[-1].append(word)
    columns = []
    heading = ''
    last_top = 0
    result = []
    section = ''; section_top = 0
    for words in rows:
        words.sort(key=lambda w: w['x0'])
        text = ' '.join(w['text'] for w in words)
        sizes = list(SIZE.finditer(text))
        if BEER_HEADING.search(text) and not re.search(r'\d',text):
            section=text; section_top=words[0]['top']
            columns=[]
        elif STOP_HEADING.search(text) and not BEER.search(text):
            section=''
        bare_sizes=not SIZE.sub('',text).strip(' /|')
        if sizes and (size_heading(text) or (bare_sizes and section and words[0]['top']-section_top<=45)) and not re.search(r'\d', SIZE.sub('', text)):
            # A second text heading belongs to a separate table on the same row.
            first_group=[sizes[0]]
            for size in sizes[1:]:
                if re.search(r'[a-zäöü]',text[first_group[-1].end():size.start()],re.I):
                    break
                first_group.append(size)
            sizes=first_group
            offsets = []; offset = 0
            for word in words:
                offsets.append((offset, offset + len(word['text']), word)); offset += len(word['text']) + 1
            columns = [(size[0], max(w['x1'] for a,b,w in offsets if a < size.end() and b > size.start())) for size in sizes]
            if any(abs(a[1]-b[1]) < 20 for a,b in zip(columns,columns[1:])):
                columns = []
            heading = (section+' / ' if bare_sizes else '')+text
            last_top = words[0]['top']
            continue
        if not columns:
            continue
        if words[0]['top'] - last_top > 45 or re.search(r'rampenverkauf|harass|take.?away|\bshots\b', text, re.I) or (STOP_HEADING.search(text) and not BEER.search(text)):
            columns = []
            continue
        if sizes:
            # A portion printed on the product row overrides the table header.
            if BEER.search(text):
                last_top = words[0]['top']
            continue
        name_words = [w for w in words if w['x1'] < columns[0][1] - 20]
        name = ' '.join(w['text'] for w in name_words)
        if not beer_product(name, heading):
            continue
        matched = []
        for size, right in columns:
            prices = [w for w in words if re.fullmatch(NUMBER, w['text']) and abs(w['x1'] - right) <= 15]
            if len(prices) == 1:
                matched.append(size + ' ' + prices[0]['text'])
        if matched:
            result.append((beer_name(name,heading) + ' ' + ' | '.join(matched), heading + ' / ' + text))
            last_top = words[0]['top']
    return result


def table_lines(lines):
    """Expand only explicitly labelled beer sizes with an exact price count."""
    sizes = []
    heading = ''
    previous = ''
    unit = None
    beer_section = False
    last_top = 0
    result = []
    for row in lines:
        text = row['text'].strip()
        found = list(SIZE.finditer(text))
        without_sizes = SIZE.sub('', text).strip(' /|')
        if BEER_HEADING.search(text) and not re.search(r'\d', text):
            beer_section = True
        elif STOP_HEADING.search(text) and not BEER.search(text):
            beer_section = False
            unit = None
        unit_header = re.search(r'\b(ml|cl|dl|l)\s+(?:CHF|Fr\.?)\b', text, re.I) or re.fullmatch(r'(ml|cl|dl|l)',text,re.I)
        if beer_section and unit_header and not re.search(r'\d', text):
            unit = unit_header[1]
            heading = text if BEER_HEADING.search(text) else previous + ' / ' + text
        elif unit:
            match = re.fullmatch(r'(.+?)\s+(\d+(?:[.,]\d+)?)\s+(' + NUMBER + ')', text)
            if match and beer_product(match[1], heading):
                result.append((f'{beer_name(match[1],heading)} {match[2]}{unit} {match[3]}', heading + ' / ' + text))
        is_header = found and not re.search(r'\d', without_sizes) and (
            size_heading(text) or (not without_sizes and size_heading(previous)))
        if is_header:
            sizes = [s[0] for s in found]
            heading = text if without_sizes else previous + ' ' + text
            last_top = row['top']
        elif sizes:
            if found or STOP_HEADING.search(text) or row['top'] - last_top > 40:
                sizes = []
            else:
                match = re.fullmatch(r'(.+?)\s+(' + NUMBER + r'(?:\s*[/|]?\s+' + NUMBER + r')*)', text)
                if match:
                    name = match[1].strip()
                    prices = re.findall(NUMBER, match[2])
                    if beer_product(name, heading) and len(prices) == len(sizes):
                        expanded = beer_name(name,heading) + ' ' + ' | '.join(s + ' ' + p for s, p in zip(sizes, prices))
                        result.append((expanded, heading + ' / ' + text))
                    else:
                        sizes = []
                # An unpriced section heading ends the table; wrapped descriptions
                # cannot be silently treated as the next beer's price.
                else:
                    sizes = []
                last_top = row['top']
        previous = text
    return result


def extract_pdf(body, url, stamp):
    offers = []
    with pdfplumber.open(BytesIO(body)) as doc:
        for number, page in enumerate(doc.pages[:25], 1):
            # Some PDFs paint headings twice; otherwise BIER becomes BBIIEERR.
            page = page.dedupe_chars()
            for region in column_regions(page):
                lines = region.extract_text_lines(x_tolerance=2, y_tolerance=3)
                context='unknown'; context_x=None; context_right=None; contexts=[]
                for row in lines:
                    heading=section_type(row['text'])
                    if heading is not None:
                        context=heading; context_x=row['x0']; context_right=row['x1']
                    # Indented headings can label a full-width product/price
                    # row (e.g. Sommereck). Narrow neighbouring columns must
                    # still not inherit a heading merely from reading order.
                    spans_heading=(context_x is not None and row['x0']<=context_x
                                   and row['x1']>=context_right
                                   and row['x1']-row['x0'] >= .65*region.width)
                    contexts.append(context if context_x is not None and (abs(row['x0']-context_x)<=60 or spans_heading) else 'unknown')
                # A small subtitle directly beneath a priced product can be its
                # brewery or alcohol-free qualifier. Require the same left edge,
                # close spacing, and a complete preceding size/price row.
                joined = []; evidence_by_line = {}
                for index, row in enumerate(lines):
                    name = row['text']
                    if index and joined and abs(row['x0'] - lines[index-1]['x0']) <= 3 and -5 <= row['top'] - lines[index-1]['bottom'] <= 10:
                        previous = joined[-1]
                        label = ((BEER.fullmatch(name) and re.match(r'^(?:(?:es|ein)\s+)?(?:grosses|großes|stange|herrg[oö]ttli|herg[oö]ttli)\b', previous, re.I)) or re.fullmatch(r'alkohol\s*frei(?:es|e|er)?|non[ -]alcoholic|alcohol[ -]free', name, re.I))
                        next_is_portion = index+1 < len(lines) and SIZE.match(lines[index+1]['text'])
                        if label and not next_is_portion and SIZE.search(previous) and extract_offers('BIER\n' + previous, url, stamp):
                            size = SIZE.search(previous)
                            combined = previous[:size.start()].rstrip() + ' ' + name + ' ' + previous[size.start():]
                            joined[-1] = combined
                            evidence_by_line[combined] = previous + ' / ' + name
                            continue
                    joined.append(name)
                text = '\n'.join(joined)
                direct = extract_offers(text, url, stamp, continuations=True)
                for offer in direct:
                    proof = offer['evidence']
                    if proof in evidence_by_line:
                        offer['evidence'] = evidence_by_line[proof]
                for index,row in enumerate(lines):
                    if any(o['evidence'] == row['text'] or o['evidence'].startswith(row['text'] + ' / ') for o in direct):
                        continue
                    for offer in extract_stange_prefix(row['text'],url,stamp):
                        annotate(offer,contexts[index])
                        offer['evidence']=f'PDF S. {number}: '+offer['evidence']
                        direct.append(offer)
                # Text order alone must not carry a neighbouring column's heading.
                for offer in direct:
                    if explicit_type(offer['evidence']) is None:
                        evidence=re.sub(r'^PDF S\. \d+: ','',offer['evidence'])
                        matches=[contexts[i] for i,row in enumerate(lines) if evidence==row['text'] or evidence.startswith(row['text']+' / ')]
                        offer['beerType']=matches[0] if matches and len(set(matches))==1 else 'unknown'
                alcohol_free = False
                for row in lines:
                    if re.fullmatch(r'(?:BIER\s+)?ALKOHOLFREI(?:ES BIER)?',row['text'],re.I):
                        alcohol_free = True
                    elif STOP_HEADING.search(row['text']) and not BEER.search(row['text']):
                        alcohol_free = False
                    if alcohol_free:
                        for offer in direct:
                            if offer['evidence'] in (row['text'],f'PDF S. {number}: '+row['text']):
                                offer['alcoholFree'] = True
                offers.extend(direct)
                header_sizes=[]
                for index, row in enumerate(lines):
                    name = row['text'].strip()
                    if SIZE.search(name) and not SIZE.sub('',name).strip(' /|'):
                        header_sizes=[s[0] for s in SIZE.finditer(name)]
                    elif STOP_HEADING.search(name) and not BEER.search(name):
                        header_sizes=[]
                    if not BEER.search(name) or SIZE.search(name) or len(name) > 100:
                        continue
                    # A named beer may wrap onto a draught/bottle and size line.
                    for following in lines[index+1:index+3]:
                        if following['top'] - row['top'] > 50:
                            break
                        part = re.sub(r'^(?:on draught|by the bottle)\s*[-–]?\s*', '', following['text'], flags=re.I)
                        part = re.sub(r'(?:\.\s*){3,}', ' ', part)
                        abv=re.match(r'^\(?<?\s*\d+(?:[.,]\d+)?\s*%\s*(?:vol\.?)?\)?\s*',part,re.I)
                        metadata=abv[0] if abv else ''
                        if abv:
                            part=part[abv.end():].strip()
                        if not part:
                            continue
                        if SIZE.match(part):
                            recovered=extract_offers(name + ' ' + metadata + ' ' + part, url, stamp)
                            for o in recovered:
                                o['evidence']=f'PDF S. {number}: {name} / {following["text"]}'[:350]
                                annotate(o,contexts[index])
                            offers.extend(recovered)
                        elif abv and header_sizes:
                            prices=re.split(r'\s*/\s*',part)
                            if len(prices)==len(header_sizes) and all(re.fullmatch(NUMBER,p) for p in prices):
                                expanded=name+' '+metadata+' '+' | '.join(s+' '+p for s,p in zip(header_sizes,prices))
                                for o in extract_offers(expanded,url,stamp):
                                    o['evidence']=f'PDF S. {number}: {" / ".join(header_sizes)} / {name} / {following["text"]}'[:350]
                                    annotate(o,contexts[index])
                                    offers.append(o)
                        break
                for expanded, evidence in table_lines(lines) + aligned_table_lines(region):
                    for offer in extract_offers(evidence.split(' / ')[0] + '\n' + expanded, url, stamp):
                        offer['evidence'] = f'PDF S. {number}: {evidence}'[:350]
                        annotate(offer)
                        offers.append(offer)
    return offers


def pdf_links(body):
    with pdfplumber.open(BytesIO(body)) as doc:
        return list(dict.fromkeys(link['uri'] for page in doc.pages[:25] for link in page.hyperlinks if link.get('uri')))
