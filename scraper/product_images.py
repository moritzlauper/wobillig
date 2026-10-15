"""Associate HTML beer images with one priced product, never neighbouring rows."""
import re
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from scraper.extract import extract_offers


def product_images(body, url):
    soup = BeautifulSoup(body, 'html.parser')
    for node in soup.select('script, style, nav, header, footer, aside'):
        node.decompose()
    result, seen = [], set()
    for image in soup.select('img[src], img[data-src]'):
        target = urljoin(url, image.get('data-src') or image.get('src', ''))
        if urlparse(target).scheme not in ('http', 'https'):
            continue
        for depth, card in enumerate(image.parents):
            if card.name in ('html', 'body', '[document]') or depth >= 8 or len(card.get_text(' ', strip=True)) > 500:
                break
            if len(card.select('img')) != 1:
                break
            offers = {}
            # Product title and price may share a nested row while ABV/unit
            # pricing sits beside it. Do not parse those extra numbers as prices.
            for row in [card, *card.select('div, p, li, tr')]:
                for offer in extract_offers(row.get_text(' ', strip=True), url, ''):
                    key = (offer['name'], offer['volumeMl'], offer['priceChf'])
                    offers[key] = offer
            if len(offers) > 1:
                break
            if offers:
                offer = next(iter(offers.values()))
                key = (target, offer['name'], offer['volumeMl'], offer['priceChf'])
                if key not in seen:
                    result.append({**offer, 'imageUrl': target})
                    seen.add(key)
                break
    return result


def image_for_offer(offer, images):
    normalize = lambda value: re.sub(r'\W+', '', value.casefold())
    return next((image for image in images
                 if normalize(image['name']) == normalize(offer['name'])
                 and image['volumeMl'] == offer['volumeMl']
                 and image['priceChf'] == offer['priceChf']), None)
