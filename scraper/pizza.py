"""Extract regular whole Margheritas; label online menu prices explicitly."""
from io import BytesIO
import re
import json
from urllib.parse import urljoin, urlparse
import unicodedata

from bs4 import BeautifulSoup
import pdfplumber
from scraper.pdf_extract import column_regions

NAME = re.compile(r'\bmargh?erita\b', re.I)
CHILDREN = re.compile(r'kinder|bambini|piccoli\s+ospiti|kleinen?\s+g[aä]ste|little\s+(?:guests|customers)|kids', re.I)
EXCLUDED = re.compile(r'kinder|bambin|baby|junior|piccol|mini\b|small\b|klein|take[ -]?away|mitnehm|liefer|delivery|famil|party|riesen|pinsa|calzone|bufal|burrata|vegan|gluten|special|spezial|regina|dop\b|d\.o\.p|extra|zuschlag|supplement|aufpreis|montanar|fritt|lunch|mittag|menu del giorno', re.I)
PRICE = re.compile(r'(?<![\w.,])(?:CHF\s*|Fr\.?\s*)?(\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?)(?:\s*(?:CHF|Fr\.?))?(?![\w.,])', re.I)
INGREDIENTS = re.compile(r'tomat\w*|pomodor\w*|mozzarella|fior\s+di\s+latte|basil\w*|oregano|olive\w*|oliven\w*|oil|olio|sauce|sugo|salsa|formaggio|käse|cheese|grana|parmesan|parmigiano|reife|frisch\w*|fresh|italian\w*|italienisch\w*|extra\s+vergine|datterini|san\s+marzano|bio|aop|dop|latte|vaccino|cow|milk|kuhmilch|di|con|e|und|and|mit', re.I)


def pizza_row(raw, url, stamp):
    line=unicodedata.normalize('NFKC', re.sub(r'\s+', ' ', raw)).strip()
    line=re.sub(r'(?:\.\s*){3,}', ' ', line)
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


def extract_pizzas(text,url,stamp):
    return list({o['priceChf']:o for line in text.splitlines() for o in pizza_row(line,url,stamp)}.values())


def pizza_html(body,url,stamp):
    soup=BeautifulSoup(body,'html.parser')
    title=soup.title.get_text(' ',strip=True) if soup.title else ''
    if re.search(r'online\s+bestellen|essen\s+bestellen|order\s+(?:food\s+)?online|food\s+delivery',title,re.I):
        return []
    for node in soup(['script','style','nav','footer','header']):node.decompose()
    offers=[]
    for row in soup.select('tr,p,li,div,article,h2,h3,h4,h5,dt'):
        text=row.get_text(' ',strip=True)
        if not NAME.search(text) or len(text)>400:continue
        level=7;excluded=False
        for heading in row.find_all_previous(re.compile(r'^h[1-6]$')):
            heading_level=int(heading.name[1])
            if heading_level<level:
                label=heading.get_text(' ',strip=True)
                if EXCLUDED.search(label) or CHILDREN.search(label):excluded=True;break
                level=heading_level
        if excluded:continue
        found=pizza_row(text,url,stamp)
        if not found and re.fullmatch(r'(?:pizza\s+)?margh?erita',text,re.I):
            sibling=row.find_next_sibling()
            if sibling and len(sibling.get_text(' ',strip=True))<200:
                found=pizza_row(text+' '+sibling.get_text(' ',strip=True),url,stamp)
        offers.extend(found)
    return list({o['priceChf']:o for o in offers}.values())


def pizza_pdf(body,url,stamp):
    offers=[]
    with pdfplumber.open(BytesIO(body)) as doc:
        for number,page in enumerate(doc.pages[:30],1):
            text=page.extract_text() or ''
            if not NAME.search(text) or CHILDREN.search(text):continue
            # A separate takeaway/children's card is never a restaurant price.
            if re.search(r'take[ -]?away|lieferkarte|delivery\s+menu|kinderkarte|bambini', '\n'.join(text.splitlines()[:5]),re.I):continue
            for region in column_regions(page):
                rows=region.extract_text_lines(x_tolerance=2,y_tolerance=3)
                for i,row in enumerate(rows):
                    if not NAME.search(row['text']) or row['top']>page.height*.94:continue
                    context=' '.join(r['text'] for r in rows[max(0,i-2):i])
                    if EXCLUDED.search(context) and re.search(r'kinder|bambini|take[ -]?away|kleine\s+piz',context,re.I):continue
                    found=pizza_row(row['text'],url,stamp)
                    if not found and i+1<len(rows):
                        next_row=rows[i+1]
                        if next_row['top']-row['top']<32 and abs(next_row['x0']-row['x0'])<30:
                            found=pizza_row(row['text']+' '+next_row['text'],url,stamp)
                    for o in found:o['evidence']=f'PDF S. {number}: '+o['evidence']
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


def pizza_orderstar(body, url, stamp):
    """Keep regular whole-pizza sizes; never use a delivery fee or discount."""
    data = json.loads(body)
    if data.get('isSuccessful') is not True: return []
    offers = []
    for category in data.get('categories', []):
        if EXCLUDED.search(category.get('name', '')): continue
        for product in category.get('products', []):
            name = product.get('name', '')
            if not re.fullmatch(r'(?:pizza\s+)?margh?erita', name, re.I): continue
            sizes = product.get('sizes') or [product]
            for size in sizes:
                size_name = size.get('name', '') if size is not product else ''
                if size_name and not re.fullmatch(r'(?:[Øø]\s*)?(?:2[6-9]|3[0-5])\s*cm', size_name, re.I): continue
                price = size.get('price')
                if isinstance(price, bool) or not isinstance(price, (int, float)): continue
                line = f"{name} {size_name} {product.get('description') or ''} CHF {price:.2f}"
                for offer in pizza_row(line, url, stamp):
                    offer['priceContext'] = 'online_menu'
                    offer['evidence'] = 'Öffentliche Online-Speisekarte: ' + offer['evidence']
                    offers.append(offer)
    return list({o['priceChf']: o for o in offers}.values())
