"""Read menu columns and explicit beer-table size headers without guessing sizes."""
from io import BytesIO
import re
import pdfplumber
from scraper.extract import BEER, SIZE, extract_offers, extract_stange_prefix

BEER_HEADING = re.compile(r'\b(?:biere?|beers?|flaschenbier[e]?|offenbier[e]?|draught|draft|bottled|vom fass)\b', re.I)
STOP_HEADING = re.compile(r'\b(?:wein[e]?|wine[s]?|soft|getränke|cocktails?|spirituosen|shots|aperitif|kaffee|coffee|tee|cider|most|säfte|spritz|gin|whisk\w*)\b', re.I)
NUMBER = r'\d{1,2}(?:[.,]\d{1,2}|[.][–—-])?'


def size_heading(text):
    """A product such as 'Amboss Weizen Bier 5dl' is NOT a size header."""
    words=re.findall(r'[a-zäöü]+',SIZE.sub('',text).casefold())
    allowed={'bier','biere','beers','beer','flaschen','flaschenbier','flaschenbiere','offenbier','offenbiere','vom','fass','frisch','gezapft','zapft','bottled','bottles','draft','draught','on','tap','alkoholfrei','alkoholfreie','alkoholfreies','alcohol','free','non','naturtrübe','naturtrüb','amber','hell','helle','weizen','weizenbiere','cl','chf'}
    return bool(words) and all(w in allowed for w in words)


def beer_name(name, heading):
    if re.search(r'^(?:alkoholfrei\w*\s+biere?|non[ .-]*alcoholic\s+beers?)\b',heading,re.I):
        return name + ' alkoholfrei'
    return name


def column_regions(page):
    """Split only at clear gutters with prose on BOTH sides, never price columns."""
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
    for words in rows:
        words.sort(key=lambda w: w['x0'])
        text = ' '.join(w['text'] for w in words)
        sizes = list(SIZE.finditer(text))
        if sizes and size_heading(text) and not re.search(r'\d', SIZE.sub('', text)):
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
            heading = text
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
        if not BEER.search(name):
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
        unit_header = re.search(r'\b(ml|cl|dl|l)\s+(?:CHF|Fr\.?)\b', text, re.I)
        if beer_section and unit_header and not re.search(r'\d', text):
            unit = unit_header[1]
            heading = text if BEER_HEADING.search(text) else previous + ' / ' + text
        elif unit:
            match = re.fullmatch(r'(.+?)\s+(\d+(?:[.,]\d+)?)\s+(' + NUMBER + ')', text)
            if match and BEER.search(match[1]):
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
                    if BEER.search(name) and len(prices) == len(sizes):
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
            for region in column_regions(page):
                lines = region.extract_text_lines(x_tolerance=2, y_tolerance=3)
                text = '\n'.join(row['text'] for row in lines)
                direct = extract_offers(text, url, stamp, continuations=True)
                for row in lines:
                    for offer in extract_stange_prefix(row['text'],url,stamp):
                        offer['evidence']=f'PDF S. {number}: '+offer['evidence']
                        direct.append(offer)
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
                            offers.extend(recovered)
                        elif abv and header_sizes:
                            prices=re.split(r'\s*/\s*',part)
                            if len(prices)==len(header_sizes) and all(re.fullmatch(NUMBER,p) for p in prices):
                                expanded=name+' '+metadata+' '+' | '.join(s+' '+p for s,p in zip(header_sizes,prices))
                                for o in extract_offers(expanded,url,stamp):
                                    o['evidence']=f'PDF S. {number}: {" / ".join(header_sizes)} / {name} / {following["text"]}'[:350]
                                    offers.append(o)
                        break
                for expanded, evidence in table_lines(lines) + aligned_table_lines(region):
                    for offer in extract_offers(expanded, url, stamp):
                        offer['evidence'] = f'PDF S. {number}: {evidence}'[:350]
                        offers.append(offer)
    return offers


def pdf_links(body):
    with pdfplumber.open(BytesIO(body)) as doc:
        return list(dict.fromkeys(link['uri'] for page in doc.pages[:25] for link in page.hyperlinks if link.get('uri')))
