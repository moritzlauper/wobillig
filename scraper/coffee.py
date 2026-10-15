"""Extract explicitly priced coffee servings, without inventing cup volumes."""
from io import BytesIO
import re
import unicodedata
import pdfplumber
from scraper.pdf_extract import column_regions

LABELS = {'creme':'Café crème', 'espresso':'Espresso', 'double':'Doppelter Espresso',
          'ristretto':'Ristretto', 'cappuccino':'Cappuccino', 'latte':'Latte macchiato',
          'milk':'Milchkaffee', 'flat_white':'Flat White', 'americano':'Americano', 'filter':'Filterkaffee'}
ALIASES = {
    'double':r'(?:doppelter? espresso|espresso dopp(?:io|elt)|double espresso|doppio(?: espresso)?)',
    'flat_white':r'flat\s*white',
    'latte':r'latte\s*macchiato',
    'milk':r'milchkaffee?|schale|cafe au lait|(?:cafe|caffe|coffee)\s*latte',
    'cappuccino':r'cappucc?ino',
    'americano':r'americano|long black',
    'filter':r'filterkaffee|filter coffee|batch brew',
    'ristretto':r'ristretto',
    'espresso':r'espresso',
    'creme':r'(?:kaffee|kafi|cafe|caffe|coffee)(?:\s*(?:creme|crema|nature))?',
}
PRICE = r'(?:CHF\s*)?(\d{1,2}(?:[.,]\d{1,2}|\.\s*[–—-])?)(?:\s*(?:CHF|Fr\.?))?'


def coffee_types(name):
    plain=''.join(c for c in unicodedata.normalize('NFKD',name.casefold()) if not unicodedata.combining(c))
    plain=re.sub(r'\((?:bio|fair\s*(?:trade|&\s*trade)|bio und fair trade)\)', '',plain)
    remaining=plain
    kinds=[]
    for kind,pattern in ALIASES.items():
        regex=r'(?<!\w)(?:'+pattern+r')(?!\w)'
        if re.search(regex,remaining):
            kinds.append(kind)
            remaining=re.sub(regex,'',remaining)
    if len(kinds)>1 and not re.search(r'[/,&|;]|\b(?:oder|or|und|and)\b',plain):
        return []
    # Reject cocktails, desserts, iced drinks, supplements, combos and descriptions.
    # A shared price is valid only when the entire label lists known coffees.
    remaining=re.sub(r'\b(?:oder|or|und|and)\b','',remaining)
    return kinds if not re.sub(r'[\s,/&|;:()«»–—-]','',remaining) else []


def extract_coffees(text,url,stamp):
    offers={}
    for raw in text.splitlines():
        line=re.sub(r'\s+',' ',raw).strip().lstrip('•*- ')
        line=re.sub(r'(?:\.\s*){3,}',' ',line)
        line=re.sub(r'(\d)\s+([.,])\s*(\d)',r'\1\2\3',line)
        # Parallel alternatives are accepted only with one explicit price per
        # fully recognised label. Keep their printed order, not alias order.
        multi=re.fullmatch(r'(.+?)\s+('+PRICE+r'(?:\s*/\s*'+PRICE+r')+)',line,re.I)
        if multi:
            labels=re.split(r'\s*/\s*',multi[1])
            prices=re.split(r'\s*/\s*',multi[2])
            if len(labels)==len(prices) and all(len(coffee_types(x))==1 for x in labels):
                for label,price in zip(labels,prices):
                    for offer in extract_coffees(label+' '+price,url,stamp):
                        offer['evidence']=raw[:350]
                        offers.setdefault((offer['coffeeType'],offer['priceChf']),offer)
            continue
        match=re.fullmatch(r'(.+?)\s+'+PRICE,line,re.I)
        if not match:
            continue
        label=match[1].strip(' |:–—-')
        kinds=coffee_types(label)
        if not kinds:
            continue
        price=float(re.sub(r'[–—-]','0',match[2]).replace(' ','').replace(',','.'))
        if not 2<=price<=12:
            continue
        for kind in kinds:
            offers.setdefault((kind,price),{'name':label if len(kinds)==1 else LABELS[kind],'coffeeType':kind,'volumeMl':None,
                'priceChf':price,'sourceUrl':url,'observedAt':stamp,'confidence':'automatic',
                'evidence':raw[:350],'alcoholFree':True})
    return list(offers.values())


def coffee_pdf(body,url,stamp):
    offers=[]
    with pdfplumber.open(BytesIO(body)) as document:
        for number,page in enumerate(document.pages[:25],1):
            # Skip wine/food pages before the more expensive layout analysis.
            if not re.search(r'kaffee|kafi|caff?[eèé]|espresso|cappuccino|flat white',page.extract_text() or '',re.I):
                continue
            for region in column_regions(page):
                rows=region.extract_text_lines(x_tolerance=2,y_tolerance=3)
                for index,row in enumerate(rows):
                    if row['top'] > page.height * .92:
                        continue
                    text=row['text']
                    found=extract_coffees(text,url,stamp)
                    if not found and coffee_types(text) and index+1<len(rows):
                        following=rows[index+1]
                        if (following['top'] < page.height * .92 and
                            following['top']-row['top']<=28 and
                            abs(following['x0']-row['x0'])<=25 and
                            re.fullmatch(PRICE,following['text'],re.I)):
                            found=extract_coffees(text+' '+following['text'],url,stamp)
                    for o in found:
                        o['evidence']=f'PDF S. {number}: '+o['evidence']
                    offers.extend(found)
    return offers
