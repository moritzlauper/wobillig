"""Ausschankart from explicit menu wording only, never brand or capacity."""
import re

PATTERNS = {
    'draft': r'\b(?:vom\s+fass|fassbier\w*|offen(?:bier\w*|ausschank|e[rs]?\s+biere?)?|(?:on|from|by)\s+(?:t\s*ap|draft|draught)|frisch\s+(?:ge)?zapft|(?:draft|draught)\s+beers?|alla\s+spina|au\s+f[uû]t|pression)\b',
    'bottle': r'\b(?:flaschenbier\w*|flaschen?|bügelflaschen?|bottles?|bottled|bouteilles?)\b',
    'can': r'\b(?:dosen?|cans?)\b',
}
SIZE_TEXT = r'\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l)\b'


def explicit_type(text):
    matches=[kind for kind,pattern in PATTERNS.items() if re.search(pattern,text,re.I)]
    # "Draft" alone can be a section title, but also part of a bottled brand.
    if not matches and re.fullmatch(r'\s*(?:draft|draught)\s*:?',text,re.I):
        return 'draft'
    return matches[0] if len(matches)==1 else 'unknown' if matches else None


def section_type(text):
    """None means ordinary product/prose, unknown explicitly resets context."""
    if len(text)>100 or re.search(r'\d',re.sub(SIZE_TEXT,'',text,flags=re.I)):
        return None
    kind=explicit_type(re.sub(SIZE_TEXT,'',text,flags=re.I).strip(' /|'))
    if kind:
        # Only short headings, not sentences describing multiple drinks.
        words=re.findall(r'[\w]+',re.sub(SIZE_TEXT,'',text,flags=re.I))
        if len(words)<=8:
            return kind
    if re.search(r'\b(?:beers?|biere?)\s*$',text,re.I):
        return 'unknown'
    if re.fullmatch(r'[\s:–—/&-]*(?:bier\w*|beers?|alkoholfrei\w*|wine\w*|wein\w*|soft\s*drinks?|mineral\w*|wasser|cocktails?|kaffee|coffee|tee|säfte|saefte|cider|most|aperitif\w*)(?:[\s:–—/&-]+(?:bier\w*|beers?|wine\w*|wein\w*|cider|most))*[\s:–—/&-]*',text,re.I):
        return 'unknown'
    return None


def annotate(offer, context='unknown', evidence=None):
    proof=evidence if evidence is not None else offer.get('evidence','')
    if offer.get('beerType','unknown')!='unknown':
        return offer
    kind=explicit_type(proof)
    # A product's explicit wording takes precedence over its section heading.
    if kind is None:
        kind=offer.get('beerType','unknown')
        if kind=='unknown':kind=context
    offer['beerType']=kind
    return offer
