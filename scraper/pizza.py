"""Extract whole pizzas from menu cards; keep the Margherita comparison separate."""
from io import BytesIO
import re
import json
from urllib.parse import urljoin, urlparse
import unicodedata
from threading import Lock

from bs4 import BeautifulSoup
import pdfplumber
from scraper.pdf_extract import column_regions

PDF_RENDER_LOCK = Lock()

NAME = re.compile(r'\bmargh?erita\b', re.I)
CHILDREN = re.compile(r'kinder|bambini|piccoli\s+ospiti|kleinen?\s+g[aä]ste|little\s+(?:guests|customers)|kids', re.I)
EXCLUDED = re.compile(r'kinder|bambin|baby|junior|piccol|mini\b|small\b|klein|take[ -]?away|mitnehm|liefer|delivery|famil|party|riesen|pinsa|calzone|bufal|burrata|vegan|gluten|special|spezial|regina|dop\b|d\.o\.p|extra|zuschlag|supplement|aufpreis|montanar|fritt|lunch|mittag|menu del giorno', re.I)
PRICE = re.compile(r'(?<![\w.,])(?:CHF\s*|Fr\.?\s*)?(\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?)(?:\s*(?:CHF|Fr\.?))?(?![\w.,])', re.I)
INGREDIENTS = re.compile(r'tomat\w*|pomodor\w*|mozzarella|fior\s+di\s+latte|basil\w*|oregano|olive\w*|oliven\w*|oil|olio|sauce|sugo|salsa|formaggio|käse|cheese|grana|parmesan|parmigiano|reife|frisch\w*|fresh|italian\w*|italienisch\w*|extra\s+vergine|datterini|san\s+marzano|bio|aop|dop|latte|vaccino|cow|milk|kuhmilch|di|con|e|und|and|mit', re.I)


def pizza_row(raw, url, stamp):
    line=unicodedata.normalize('NFKC', re.sub(r'\s+', ' ', raw)).strip()
    line=re.sub(r'(?:\.\s*){3,}', ' ', line)
    line=re.sub(r'(\d)\s*([.,])\s+(\d{2})\b', r'\1\2\3', line)
    # Some menu cards render the price before the product heading.
    leading=re.match(r'^((?:CHF\s*)?\d{1,2}[.,]\d{2}(?:\s*CHF)?)\s+((?:pizza\s+)?margh?erita\b.*)', line, re.I)
    if leading: line=leading[2]+' '+leading[1]
    if not NAME.search(line) or EXCLUDED.search(line) or len(line)>400:
        return []
    # Only a standalone Margherita label with recognised ingredient prose.
    match=re.match(r'^(?:\d{1,3}[.)]?\s+)?(?:pizza\s+)?margh?erita\b',line,re.I)
    if not match:
        return []
    rest=line[match.end():]
    # A stated standard diameter is evidence, never a price. Reject tiny/giant sizes.
    sizes=re.findall(r'(?:[Øø⌀]\s*)?(\d{2})\s*cm\b',rest,re.I)
    if sizes and (len(sizes)!=1 or not 26<=int(sizes[0])<=35):
        return []
    rest=re.sub(r'(?:[Øø⌀]\s*)?\d{2}\s*cm\b','',rest,flags=re.I)
    prices=list(PRICE.finditer(rest))
    if len(prices)!=1:
        return []
    price=float(re.sub(r'[–—-]','0',prices[0][1]).replace(' ','').replace(',','.'))
    if not 7<=price<=40:
        return []
    description=rest[:prices[0].start()]+' '+rest[prices[0].end():]
    description=re.sub(r'\((?:[a-z](?:\s*[,/]\s*[a-z])*)\)', '', description,flags=re.I)
    description=re.sub(r'\b(?:v|vg|vegetarisch|vegetarian)\b','',description,flags=re.I)
    description=re.sub(r'\b(?:pizza|padano|reggiano|fiordilatte|klassiker|mit|nativ\w*|frischem|frischer|italiano|italiana|pelato|kaltgepresst\w*)\b','',description,flags=re.I)
    description=INGREDIENTS.sub('',description)
    if re.sub(r'[\s,;:|/().·•*–—&+-]','',description):
        return []
    return [{'name':'Pizza Margherita','pizzaType':'margherita','volumeMl':None,'priceChf':price,
             'sourceUrl':url,'observedAt':stamp,'confidence':'automatic','evidence':line[:400],'alcoholFree':True}]


def other_pizza(row, url, stamp):
    """Keep explicitly evidenced regular pizzas out of the Margherita offer list."""
    name, evidence, price = row['name'].strip(), row['evidence'], row['priceChf']
    normalize = lambda value: re.sub(r'\s+', '', value.casefold())
    if row.get('isPizza') is not True or row.get('pizzaType') != 'other':
        return []
    if not re.search(r'\bpizz[ae]\b', row.get('menuSection', ''), re.I):
        return []
    if not 2 <= len(name) <= 100 or normalize(name) not in normalize(evidence):
        return []
    if re.search(r'kinder|bambin|baby|junior|piccol|mini\b|small\b|klein|famil|party|riesen|pinsa|calzone|slice|supplement|aufpreis|zuschlag|take[ -]?away|delivery|liefer|lunch|mittag|\b(?:pasta|spaghetti|risotto|salat|salad)\b', name+' '+evidence, re.I):
        return []
    sizes = re.findall(r'(?:[Øø⌀]\s*)?(\d{2})\s*cm\b', evidence, re.I)
    if sizes and (len(sizes) != 1 or not 26 <= int(sizes[0]) <= 35):
        return []
    without_sizes = re.sub(r'(?:[Øø⌀]\s*)?\d{2}\s*cm\b', '', evidence, flags=re.I)
    # A menu's product number belongs to its label, not to the price column.
    number = re.match(r'^\d{1,3}[A-Za-z]?[.)]?\s+', name)
    if number and without_sizes.startswith(number[0]):
        without_sizes = without_sizes[len(number[0]):]
    amounts = [float(re.sub(r'[–—-]', '0', match[1]).replace(' ', '').replace(',', '.'))
               for match in PRICE.finditer(without_sizes)]
    plausible = [amount for amount in amounts if 7 <= amount <= 60]
    if len(plausible) != 1 or abs(plausible[0] - price) > .001:
        return []
    # Do not let misclassification create a second ordinary Margherita row.
    if re.fullmatch(r'(?:pizza\s+)?margh?erita', name, re.I):
        return []
    return [{'name': name, 'pizzaType': 'other', 'volumeMl': None, 'priceChf': price,
             'sourceUrl': url, 'observedAt': stamp, 'evidence': evidence,
             'alcoholFree': True}]


def extract_pizzas(text,url,stamp):
    return list({o['priceChf']:o for line in text.splitlines() for o in pizza_row(line,url,stamp)}.values())


def pizza_html(body,url,stamp, *, all_pizzas=False):
    soup=BeautifulSoup(body,'html.parser')
    title=soup.title.get_text(' ',strip=True) if soup.title else ''
    online=bool(re.search(r'/(?:online-ordering|bestellen|order|shop)(?:/|$)',urlparse(url).path,re.I) or re.search(r'online\s+bestellen|essen\s+bestellen|order\s+(?:food\s+)?online|food\s+delivery',title,re.I) or soup.select_one('.menu-toopen, .meal-wrapper, .add_to_cart_button'))
    for node in soup(['script','style','nav','footer','header']):node.decompose()
    offers=product_card_pizzas(soup,url,stamp,all_pizzas=all_pizzas)
    for card in soup.select('.meal-wrapper, .wppizza-article, form[hx-get]'):card.decompose()
    for row in soup.select('tr,p,li,div,article,h2,h3,h4,h5,dt'):
        text=row.get_text(' ',strip=True)
        if not NAME.search(text) or len(text)>400:continue
        level=7;excluded=False
        for heading in row.find_all_previous(re.compile(r'^h[1-6]$')):
            heading_level=int(heading.name[1])
            if heading_level<level:
                label=heading.get_text(' ',strip=True)
                if CHILDREN.search(label) or ((heading_level<=2 or re.search(r'pizz|menu|portion',label,re.I)) and EXCLUDED.search(label)):excluded=True;break
                level=heading_level
        if excluded:continue
        found=pizza_row(text,url,stamp)
        if not found and re.fullmatch(r'(?:pizza\s+)?margh?erita',text,re.I):
            sibling=row.find_next_sibling()
            if sibling and len(sibling.get_text(' ',strip=True))<200:
                found=pizza_row(text+' '+sibling.get_text(' ',strip=True),url,stamp)
        offers.extend(found)
    if online:
        for offer in offers: offer['priceContext']='online_menu'
    return list({(o['name'],o['priceChf']):o for o in offers}.values())



def pizza_product(name, description, price, size, url, stamp, *, all_pizzas=False, section=''):
    """Read a product's own price/selected size, never its extra toppings."""
    name, description, price, size = (' '.join(value.split()) for value in (name, description, price, size))
    if size and not re.fullmatch(r'(?:[Øø⌀]\s*)?(?:2[6-9]|3[0-5])\s*cm', size, re.I):
        return []
    line = ' '.join(filter(None, (name, size, description, price)))
    found = pizza_row(line, url, stamp)
    if not found and all_pizzas:
        amount = PRICE.fullmatch(price)
        if not amount:
            return []
        value = float(re.sub(r'[–—-]', '0', amount[1]).replace(' ', '').replace(',', '.'))
        found = other_pizza({'name': name, 'evidence': line, 'priceChf': value,
                             'pizzaType': 'other', 'isPizza': True,
                             'menuSection': 'Pizza' if re.match(r'^pizza\s+', name, re.I) else section}, url, stamp)
    for offer in found:
        offer['confidence'] = 'automatic'
        offer['priceContext'] = 'online_menu'
        if description:
            offer['ingredients'] = description
    return found


def product_card_pizzas(soup, url, stamp, *, all_pizzas=False):
    offers=[]
    def add(name, description, price, size='', section=''):
        # A product heading does not override an enclosing children's/lunch menu.
        level = 7
        for heading in card.find_all_previous(re.compile(r'^h[1-6]$')):
            heading_level = int(heading.name[1])
            if heading_level < level:
                label = heading.get_text(' ', strip=True)
                if CHILDREN.search(label) or re.search(r'take[ -]?away|delivery|liefer|famil|lunch|mittag', label, re.I):
                    return
                level = heading_level
        offers.extend(pizza_product(name, description, price, size, url, stamp,
                                    all_pizzas=all_pizzas, section=section))
    for card in soup.select('.meal-wrapper'):
        name=card.select_one('[itemprop="name"], .product-name')
        price=card.select_one('[itemprop="price"], .product-price')
        description=card.select_one('[itemprop="description"], .product-description')
        if name and price:
            group=card.find_parent(class_='menucat')
            category=group.select_one('.category-name, .category-title, .menucard__category-name') if group else None
            if category is None: category=card.find_previous(re.compile(r'^h[12]$'))
            size=category.get_text(' ',strip=True) if category else ''
            sizes=re.findall(r'(?<!\d)(\d{2})\s*cm',size,re.I)
            if EXCLUDED.search(size) or CHILDREN.search(size) or len(set(sizes))>1 or (sizes and any(not 26<=int(n)<=35 for n in sizes)):continue
            add(name.get_text(' ',strip=True),description.get_text(' ',strip=True) if description else '',price.get_text(' ',strip=True),
                sizes[0]+' cm' if sizes else '',section=size)
    for card in soup.select('.wppizza-article'):
        name=card.select_one('.wppizza-article-title')
        if not name or (not all_pizzas and not NAME.search(name.get_text())):continue
        desc=card.select_one('.wppizza-article-content')
        for variant in card.select('.wppizza-article-price'):
            size=variant.select_one('.wppizza-article-size');price=variant.select_one('span')
            if size and price:add(name.get_text(' ',strip=True),desc.get_text(' ',strip=True) if desc else '',price.get_text(' ',strip=True),size.get_text(' ',strip=True),section='Pizza')
    for card in soup.select('.product'):
        name=card.select_one('.name, .woocommerce-loop-product__title')
        if not name or (not all_pizzas and not NAME.search(name.get_text())):continue
        desc=card.select_one('.woocommerce-product-details__short-description')
        for variant in card.select('.lafka-variations-in-catalog'):
            label=variant.select_one('.lafka-list-variation-label');price=variant.select_one('.amount')
            if not label or not price:continue
            size=re.search(r'[Øø]\s*(\d{2})',label.get_text())
            if size:add(name.get_text(' ',strip=True),desc.get_text(' ',strip=True) if desc else '',price.get_text('',strip=True),size[1]+' cm')
    for card in soup.select('form[hx-get]'):
        name=card.select_one('h3');price=card.select_one('[x-text="price"]')
        if not name or not price:continue
        selections=card.select('input[name="size"][checked]')
        if len(selections)>1:continue
        selected=selections[0] if selections else None
        size=card.find('label',attrs={'for':selected.get('id')}) if selected else None
        if card.select_one('input[name="size"]') and size is None:continue
        description=card.select_one('.space-y-1')
        add(name.get_text(' ',strip=True),description.get_text(' ',strip=True) if description else '',
            price.get_text(' ',strip=True),size.get_text(' ',strip=True) if size else '')
    for name in soup.select('td > b'):
        label=name.get_text(' ',strip=True)
        if not all_pizzas and not NAME.search(label):continue
        card=name.parent
        price=card.select_one('.price')
        desc=card.select_one('.desc')
        if not price:continue
        sizes=re.findall(r'(?<!\d)(\d{2})\s*cm',label,re.I)
        if not sizes:
            options=card.select('input[value]')
            sizes=list(set(n for option in options for n in re.findall(r'Zutaten\s*(\d{2})\s*cm',option.get('value',''),re.I)))
        if len(sizes)>1 or (sizes and not 26<=int(sizes[0])<=35):continue
        add(label,desc.get_text(' ',strip=True) if desc else '',price.get_text(' ',strip=True),sizes[0]+' cm' if sizes and 'cm' not in label else '')
    return offers

def pizza_page(page, url, stamp, number):
    offers = []
    page = page.dedupe_chars()
    text = page.extract_text() or ''
    if not NAME.search(text): return []
    # A children section elsewhere on the page must not suppress adult pizzas.
    first = next((line.strip() for line in text.splitlines() if line.strip()), '')
    if re.match(r'^(?:kinderkarte|bambini|take[ -]?away(?:\s+menu)?$|delivery\s+menu)', first, re.I):
        return []
    for region in column_regions(page):
        rows = region.extract_text_lines(x_tolerance=2, y_tolerance=3)
        children = False
        for i, row in enumerate(rows):
            label = row['text']
            if CHILDREN.search(label) and not NAME.search(label) and len(label) < 100:
                children = True
            elif re.fullmatch(r'(?:le nostre\s+)?pizz[ae](?:\s+classiche)?', label.strip(), re.I):
                children = False
            if children or not NAME.search(label) or row['top'] > page.height * .94: continue
            found = pizza_row(label, url, stamp)
            if not found:
                # Two menu panels can share a row beneath a full-width heading.
                # Split only when a second named, priced dish follows the first.
                for price in PRICE.finditer(label):
                    tail=label[price.end():].strip()
                    if re.match(r'[A-ZÄÖÜ][A-Za-zÄÖÜäöü ]+\s+\d',tail):
                        found=pizza_row(label[:price.end()],url,stamp)
                        if found:break
            combined = label
            # Name, ingredients and price may occupy three separate nearby rows.
            for following in rows[i+1:i+4]:
                if found or following['top'] - row['top'] > 60: break
                if abs(following['x0'] - row['x0']) > 50 and not re.fullmatch(r'(?:CHF\s*)?\d{1,2}(?:[.,]\d{1,2})?', following['text']): break
                combined += ' ' + following['text']
                found = pizza_row(combined, url, stamp)
            for offer in found: offer['evidence'] = f'PDF S. {number}: ' + offer['evidence']
            offers.extend(found)
    return offers


def ocr_pizza_image(image, url, stamp, number=1):
    from scraper.menu_ocr import searchable_image
    body, words = searchable_image(image)
    # OCR is accepted only with a clearly recognised product name and price.
    names = [w for w in words if NAME.search(w['text'])]
    if not any(float(w['conf']) >= 85 for w in names): return []
    with pdfplumber.open(BytesIO(body)) as doc:
        offers = pizza_page(doc.pages[0], url, stamp, number)
    numeric_words=list(words)
    for word in words:
        if re.fullmatch(r'\d{1,2}[.,]',word['text']):
            for tail in words:
                gap=int(tail['left'])-int(word['left'])-int(word['width'])
                if re.fullmatch(r'\d{2}',tail['text']) and 0<=gap<=int(word['height']) and abs(int(tail['top'])-int(word['top']))<=4:
                    numeric_words.append({**word,'text':word['text']+tail['text'],'conf':str(min(float(word['conf']),float(tail['conf'])))})
    result = []
    for offer in offers:
        price = offer['priceChf']
        matching = [w for w in numeric_words if re.fullmatch(r'(?:CHF)?\d{1,2}(?:[.,]\d{1,2}|[.]?[–—-])?', w['text'])
                    and any(abs(float(m[1].replace(',', '.').rstrip('.–—-')) - price) < .001 for m in PRICE.finditer(w['text']))]
        if not any(float(w['conf']) >= 85 and any(float(n['conf']) >= 85 and abs(int(w['top'])-int(n['top'])) <= max(100, int(n['height'])*4) for n in names) for w in matching): continue
        offer['evidence'] = 'OCR ' + offer['evidence']
        offer['extractionMethod'] = 'ocr'
        result.append(offer)
    return result


def pizza_image(body, url, stamp):
    from scraper.menu_ocr import image_from_bytes
    return ocr_pizza_image(image_from_bytes(body), url, stamp)


def pizza_pdf(body, url, stamp, *, ocr=True):
    offers = []
    with pdfplumber.open(BytesIO(body)) as doc:
        for number, page in enumerate(doc.pages[:30], 1):
            found = pizza_page(page, url, stamp, number)
            # Tiny headers/page numbers are not a usable text layer. Large raster
            # images can also carry the menu beneath a selectable title.
            image_area = sum(max(0, i['x1']-i['x0']) * max(0, i['bottom']-i['top']) for i in page.images)
            sparse = len(page.chars) < 120
            if ocr and not found and page.images and (sparse or image_area > page.width * page.height * .6):
                # PDFium rendering is not thread-safe; network/OCR work stays parallel.
                with PDF_RENDER_LOCK:
                    rendered = page.to_image(resolution=min(200,3500*72/max(page.width,page.height))).original.copy()
                found = ocr_pizza_image(rendered, url, stamp, number)
            offers.extend(found)
    return list({o['priceChf']:o for o in offers}.values())


def structured_menu_links(body, url):
    """Read location-owned schema.org menus, including external PDF hosts."""
    soup = BeautifulSoup(body, 'html.parser')
    result = []
    def visit(value):
        if isinstance(value, list):
            for child in value: visit(child)
        elif isinstance(value, dict):
            types = value.get('@type', [])
            if isinstance(types, str): types = [types]
            owner = value.get('url')
            if (any(t in ('Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub') for t in types)
                    and (not owner or urljoin(url, owner).rstrip('/') == url.rstrip('/'))):
                for key in ('menu', 'hasMenu'):
                    menus = value.get(key, [])
                    if not isinstance(menus, list): menus = [menus]
                    for menu in menus:
                        if isinstance(menu, dict): menu = menu.get('url', '')
                        if isinstance(menu, str) and menu:
                            target = urljoin(url, menu)
                            if urlparse(target).scheme in ('http', 'https'):
                                result.append(target)
            for child in value.values():
                if isinstance(child, (dict, list)): visit(child)
    for script in soup.select('script[type="application/ld+json"]'):
        try: visit(json.loads(script.string or script.get_text()))
        except (ValueError, TypeError): pass
    return list(dict.fromkeys(result))


def orderstar_menu_url(body, url):
    """The public read-only menu feed used by Orderstar restaurant homepages."""
    soup = BeautifulSoup(body, 'html.parser')
    if any('/bundles/js/orderstar.loc.js' in s.get('src', '') for s in soup.select('script[src]')):
        return urljoin(url, '/Home/GetHomeData')
    return None


def pizza_orderstar(body, url, stamp, *, all_pizzas=False):
    """Keep regular whole-pizza sizes; never use a delivery fee or discount."""
    data = json.loads(body)
    if data.get('isSuccessful') is not True: return []
    offers = []
    for category in data.get('categories', []):
        if EXCLUDED.search(category.get('name', '')): continue
        for product in category.get('products', []):
            name = product.get('name', '')
            if not all_pizzas and not re.fullmatch(r'(?:pizza\s+)?margh?erita', name, re.I): continue
            sizes = product.get('sizes') or [product]
            for size in sizes:
                size_name = size.get('name', '') if size is not product else ''
                if size_name and not re.fullmatch(r'(?:[Øø]\s*)?(?:2[6-9]|3[0-5])\s*cm', size_name, re.I): continue
                price = size.get('price')
                if isinstance(price, bool) or not isinstance(price, (int, float)): continue
                for offer in pizza_product(name, product.get('description') or '', f'CHF {price:.2f}',
                                           size_name, url, stamp, all_pizzas=all_pizzas, section=category.get('name', '')):
                    offer['evidence'] = 'Öffentliche Online-Speisekarte: ' + offer['evidence']
                    offers.append(offer)
    return list({(o['name'], o['priceChf']): o for o in offers}.values())
