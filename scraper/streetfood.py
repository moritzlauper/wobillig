"""Conservative Döner-Dürüm/Falafel-Dürüm extraction from HTML, PDF and scans.

Only standard wraps qualify. Bread, boxes, plates, bundles, extras and ambiguous
price/size columns never become comparable Dürüm prices.
"""
from io import BytesIO
import json
import re
import unicodedata
from urllib.parse import urlparse

from bs4 import BeautifulSoup
import pdfplumber
from scraper.pdf_extract import column_regions
from scraper.pizza import PRICE, PDF_RENDER_LOCK

LABELS = {'doner': 'Döner', 'falafel': 'Falafel'}
NAME = re.compile(r'\b(?:d[oö]ner|doener|d[uü]r[uü]m|dueruem|keba[bp]|falafel)\b', re.I)
EXCLUDED = re.compile(r'\b(?:teller|plate|box|bowl|portion|st[uü]ck|pieces?|menu|men[uü]s?|combo|komb[iy]|kinder|kids|mini|klein|small|gross|groß|large|xxl|jumbo|mega|extra|zuschlag|aufpreis|supplement|pizza|pide|lahmacun|iskender|adana|shish|sis|spiess|spieß|burger|pommes|fries|getr[aä]nk\w*)\b', re.I)
WRAP = re.compile(r'\b(?:d[uü]r[uü]m|dueruem|wrap|yufka|tortilla|gerollt)\b', re.I)


def food_row(raw, url, stamp, category):
    if category not in LABELS:
        raise ValueError('Unknown street-food category')
    line = unicodedata.normalize('NFKC', re.sub(r'\s+', ' ', raw)).strip()
    line = re.sub(r'(?:\.\s*){3,}', ' ', line)
    line = re.sub(r'(\d)\s*([.,])\s+(\d{2})\b', r'\1\2\3', line)
    if len(line) > 350 or EXCLUDED.search(line):
        return []
    # Names must identify a dish, not a mention in another dish's ingredients.
    label = re.sub(r'^\d{1,3}[.)]?\s+', '', line)
    if not re.match(r'^(?:(?:poulet|chicken|kalb|rind|beef|veal|vegi|vegetarisch|vegan|classic|klassisch)\s+)?(?:d[oö]ner|doener|d[uü]r[uü]m|dueruem|keba[bp]|falafel)\b', label, re.I):
        return []
    is_falafel = bool(re.search(r'\bfalafel\b', label, re.I))
    if (category == 'falafel') != is_falafel:
        return []
    if category == 'doner' and re.search(r'\b(?:vegi|vegan|vegetarisch|halloumi|sucuk|gem[uü]se|vegetable|fisch|fish|cig|çiğ)\b', label, re.I):
        return []
    if is_falafel and re.search(r'\b(?:d[oö]ner|doener|keba[bp]|poulet|chicken|kalb|rind|fleisch)\b', label, re.I):
        return []
    prices = list(PRICE.finditer(label))
    if len(prices) != 1:
        return []
    price = float(re.sub(r'[–—-]', '0', prices[0][1]).replace(' ', '').replace(',', '.'))
    if not 5 <= price <= 25:
        return []
    description = label[:prices[0].start()].strip(' :|.–-')
    if re.search(r'\d', description):
        return []  # Explicit gram/size variants are not standard portions.
    # A price must finish the row, apart from a harmless currency or footnote.
    if re.sub(r'[\s*†]', '', label[prices[0].end():]):
        return []
    wrap = bool(WRAP.search(description))
    # "Dürüm im Fladenbrot" describes a wrap, not two separate portion options.
    if wrap and re.search(r'\b(?:taschenbrot|pita|pitta|sandwich)\b', description, re.I):
        return []
    if not wrap:
        return []  # Bread and unspecified portions are outside the Dürüm comparison.
    portion = 'wrap'
    meat = 'vegetarian' if is_falafel else 'chicken' if re.search(r'\bpoulet|\bchicken', description, re.I) else 'veal' if re.search(r'\bkalb|\bveal', description, re.I) else 'beef' if re.search(r'\brind|\bbeef', description, re.I) else 'unspecified'
    if category == 'doner' and len(re.findall(r'\b(?:poulet|chicken|kalb|veal|rind|beef)\b', description, re.I)) > 1:
        return []
    return [{'name': description, 'foodType': category, 'portionType': portion, 'meatType': meat,
             'volumeMl': None, 'priceChf': price, 'sourceUrl': url, 'observedAt': stamp,
             'confidence': 'automatic', 'evidence': line, 'alcoholFree': True}]


def unique(offers):
    return list({(o['portionType'], o['meatType'], o['priceChf']): o for o in offers}.values())


def food_html(body, url, stamp, category):
    soup = BeautifulSoup(body, 'html.parser')
    title = soup.title.get_text(' ', strip=True) if soup.title else ''
    online = bool(re.search(r'/(?:bestellen|order|shop|online-ordering)(?:/|$)', urlparse(url).path, re.I)
                  or re.search(r'online\s+bestellen|essen\s+bestellen|order\s+(?:food\s+)?online|food\s+delivery', title, re.I)
                  or soup.select_one('.meal-wrapper, .add_to_cart_button'))
    for node in soup(['script', 'style', 'nav', 'footer', 'header']):
        node.decompose()
    offers = []
    for row in soup.select('tr,p,li,div,article,h2,h3,h4,h5,dt'):
        text = row.get_text(' ', strip=True)
        if not NAME.search(text) or len(text) > 350:
            continue
        # Carry section exclusions without letting a previous sibling dish
        # heading suppress an unrelated standard sandwich further down.
        level, excluded = 7, False
        for heading in row.find_all_previous(re.compile(r'^h[1-6]$')):
            heading_level = int(heading.name[1])
            if heading_level < level:
                title = heading.get_text(' ', strip=True)
                if not PRICE.search(title) and EXCLUDED.search(title) and not re.fullmatch(r'(?:unsere?\s+)?men[uü]', title, re.I):
                    excluded = True; break
                level = heading_level
        if excluded:
            continue
        found = food_row(text, url, stamp, category)
        # Join only a dedicated name/price pair; never borrow a neighbouring dish.
        sibling = row.find_next_sibling()
        if not found and not PRICE.search(text) and sibling:
            price = sibling.get_text(' ', strip=True)
            if re.fullmatch(r'(?:CHF\s*|Fr\.?\s*)?\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?(?:\s*(?:CHF|Fr\.?))?', price, re.I):
                found = food_row(text + ' ' + price, url, stamp, category)
        offers.extend(found)
    if online:
        for offer in offers:
            offer['priceContext'] = 'online_menu'
    return unique(offers)


def food_page(page, url, stamp, category, number):
    offers = []
    for region in column_regions(page.dedupe_chars()):
        rows = region.extract_text_lines(x_tolerance=2, y_tolerance=3)
        excluded = False
        for index, row in enumerate(rows):
            text = row['text']
            if not PRICE.search(text) and len(text) < 80:
                if EXCLUDED.search(text) and not re.fullmatch(r'(?:unsere?\s+)?men[uü]', text, re.I):
                    excluded = True
                elif NAME.search(text) or re.fullmatch(r'sandwiches?|wraps?', text, re.I):
                    excluded = False
            if excluded or not NAME.search(text):
                continue
            found = food_row(text, url, stamp, category)
            if not found and not PRICE.search(text) and index + 1 < len(rows):
                following = rows[index + 1]
                if following['top'] - row['top'] < 40 and re.fullmatch(r'(?:CHF\s*)?\d{1,2}[.,]\d{2}', following['text']):
                    found = food_row(text + ' ' + following['text'], url, stamp, category)
            for offer in found:
                offer['evidence'] = f'PDF S. {number}: ' + offer['evidence']
            offers.extend(found)
    return unique(offers)


def ocr_food(image, url, stamp, category, number=1):
    from scraper.menu_ocr import searchable_image
    body, words = searchable_image(image)
    names = [w for w in words if NAME.search(w['text']) and float(w['conf']) >= 85]
    if not names:
        return []
    with pdfplumber.open(BytesIO(body)) as doc:
        found = food_page(doc.pages[0], url, stamp, category, number)
    offers = []
    for offer in found:
        matching = [w for w in words if float(w['conf']) >= 85 and re.fullmatch(r'\d{1,2}(?:[.,]\d{1,2}|[.]?[–—-])', w['text'])
                    and abs(float(w['text'].replace(',', '.').rstrip('.–—-')) - offer['priceChf']) < .001]
        if not any(abs(int(w['top']) - int(n['top'])) <= max(80, int(n['height']) * 3) for w in matching for n in names):
            continue
        offer['extractionMethod'] = 'ocr'
        offer['evidence'] = 'OCR ' + offer['evidence']
        offers.append(offer)
    return offers


def food_image(body, url, stamp, category):
    from scraper.menu_ocr import image_from_bytes
    return ocr_food(image_from_bytes(body), url, stamp, category)


def food_pdf(body, url, stamp, category, *, ocr=True):
    offers = []
    with pdfplumber.open(BytesIO(body)) as doc:
        for number, page in enumerate(doc.pages[:30], 1):
            found = food_page(page, url, stamp, category, number)
            image_area = sum(max(0, i['x1'] - i['x0']) * max(0, i['bottom'] - i['top']) for i in page.images)
            if ocr and not found and page.images and (len(page.chars) < 120 or image_area > page.width * page.height * .6):
                with PDF_RENDER_LOCK:
                    image = page.to_image(resolution=min(200, 3500 * 72 / max(page.width, page.height))).original.copy()
                found = ocr_food(image, url, stamp, category, number)
            offers.extend(found)
    return unique(offers)


def food_orderstar(body, url, stamp, category):
    data = json.loads(body)
    if data.get('isSuccessful') is not True:
        return []
    offers = []
    for section in data.get('categories', []):
        if EXCLUDED.search(section.get('name', '')):
            continue
        for product in section.get('products', []):
            for size in product.get('sizes') or [product]:
                size_name = size.get('name', '') if size is not product else ''
                if size_name and not re.fullmatch(r'normal|standard|regular', size_name, re.I):
                    continue
                price = size.get('price')
                if isinstance(price, bool) or not isinstance(price, (int, float)):
                    continue
                for offer in food_row(f'{product.get("name", "")} CHF {price:.2f}', url, stamp, category):
                    offer['priceContext'] = 'online_menu'
                    offers.append(offer)
    return unique(offers)
