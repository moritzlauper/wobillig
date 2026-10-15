import copy
import hashlib
import json
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scraper.ai import clean_offers
from scraper.ai_scan import classify_existing, merge_offers, scan_venue
from scraper.estimates import estimate_types
from scraper.product_images import product_images
from scraper.scrape import scrape_bar


URL = 'https://darbar.ch/menu/'
BODY = (Path(__file__).parent / 'fixtures/darbar-beer.html').read_bytes()


class ProductImageTests(unittest.TestCase):
    def test_darbar_images_are_associated_with_exact_products_and_prices(self):
        found = product_images(BODY, URL)
        self.assertEqual([(o['name'], o['volumeMl'], o['priceChf']) for o in found], [
            ('Feldschlösschen', 500, 5), ('Heineken', 500, 5),
            ('Kingfisher Bier', 330, 6.5), ('Feldschlösschen Alkoholfrei', 330, 5.5)])
        self.assertIn('FELDSCHLOSSCHEN-0.5L', found[0]['imageUrl'])
        self.assertIn('Heineken', found[1]['imageUrl'])

    def test_decorations_and_ambiguous_neighbouring_rows_are_excluded(self):
        for body in [
            '<nav><img src="/beer.jpg"><p>Lager 5dl 5.00</p></nav>',
            '<section><img src="/beer.jpg"><p>Lager 5dl 5.00</p><p>Heineken 5dl 6.00</p></section>',
            '<div><img src="file:///beer.jpg"><p>Lager 5dl 5.00</p></div>',
            '<div><img src="/beer.jpg"><p>Logo</p></div><div>Lager 5dl 5.00</div>',
            '<html><body><img src="/logo.jpg"><p>Lager 5dl 5.00</p></body></html>',
        ]:
            self.assertEqual(product_images(body, URL), [], body)

    def row(self):
        return dict(name='Feldschlösschen', drink='beer', volumeMl=500,
                    priceChf=5, beerType='unknown', estimatedBeerType='can',
                    estimatedFromImage=True, estimateReason='Das zugeordnete Produktbild zeigt eine Dose.',
                    alcoholFree=False, stange=False, evidence='Feldschlösschen 0.5L CHF 5.00', page=1)

    def test_scan_sends_actual_images_and_keeps_visual_reason(self):
        images = product_images(BODY, URL)
        fetcher = Mock()
        fetcher.get.side_effect = lambda url: (url, 'text/html', BODY) if url == URL else (url, 'image/jpeg', b'image-bytes')
        client = Mock()
        client.ask.return_value = {'offers': [self.row()]}
        bar = dict(id='test', name='Darbar', website=URL, offers=[])
        found, _, failures = scan_venue(bar, client, fetcher, {}, 1, time.monotonic() + 30)
        self.assertEqual(failures, [])
        blocks = client.ask.call_args.args[0]
        self.assertEqual(sum(b['type'] == 'image' for b in blocks), 4)
        estimate = found[0]['beerTypeEstimate']
        self.assertEqual(estimate['sourceImage'], images[0]['imageUrl'])
        self.assertEqual(estimate['reason'], self.row()['estimateReason'])
        self.assertEqual(found[0]['beerType'], 'unknown')
        old = {**found[0], 'beerTypeEstimate': {'type': 'draft', 'method': 'ai'}}
        merged = merge_offers([old], found)[0]
        smaller = {**merged, 'volumeMl': 300, 'beerTypeEstimate': {'type': 'draft', 'method': 'ai'}}
        estimate_types([{'offers': [merged, smaller]}])
        self.assertEqual(merged['beerTypeEstimate'], estimate)
        self.assertEqual(merge_offers([merged], [old])[0]['beerTypeEstimate'], estimate)

    def test_failed_image_fetch_cannot_claim_visual_evidence(self):
        fetcher = Mock()
        def get(url):
            if url == URL: return url, 'text/html', BODY
            raise ValueError('robots_blocked')
        fetcher.get.side_effect = get
        client = Mock()
        client.ask.return_value = {'offers': [self.row()]}
        bar = dict(id='test', name='Darbar', website=URL, offers=[])
        found, _, failures = scan_venue(bar, client, fetcher, {}, 1, time.monotonic() + 30)
        self.assertEqual(len(failures), 4)
        self.assertNotIn('beerTypeEstimate', found[0])
        self.assertFalse(any(b['type'] == 'image' for b in client.ask.call_args.args[0]))

    def test_visual_claim_requires_matching_product_size_and_price(self):
        row = self.row()
        for field, value in [('name', 'Heineken'), ('volumeMl', 330), ('priceChf', 6)]:
            images = copy.deepcopy(product_images(BODY, URL)[:1])
            images[0][field] = value
            found = clean_offers({'offers': [row]}, URL, 'today', source_text=row['evidence'], product_images=images)
            self.assertNotIn('beerTypeEstimate', found[0])

    def test_text_estimates_include_prices_and_keep_specific_reason(self):
        offer = product_images(BODY, URL)[0]
        client = Mock()
        client.ask.return_value = {'estimates': [{'id': 0, 'type': 'can', 'reason': 'Konkrete Schätzbegründung'}]}
        classify_existing(client, [{'name': 'Darbar', 'offers': [offer]}])
        rows = json.loads(client.ask.call_args.args[0][0]['text'])
        self.assertEqual(rows[0]['priceChf'], 5)
        self.assertEqual(rows[0]['alternatives'][0]['priceChf'], 5)
        self.assertEqual(offer['beerTypeEstimate']['reason'], 'Konkrete Schätzbegründung')

    def test_reviewed_darbar_formats_survive_same_menu_rescrape(self):
        reviews = json.loads(Path('scraper/reviewed_menus.json').read_text())
        review = reviews[URL]
        review['sha256'] = hashlib.sha256(BODY).hexdigest()
        fetcher = Mock()
        fetcher.get.return_value = (URL, 'text/html', BODY)
        with patch('scraper.scrape.REVIEWED_MENUS', {URL: review}):
            result = scrape_bar(dict(id=review['barId'], website=URL, offers=[]), fetcher, {}, 1)
        estimate_types([result])
        self.assertEqual([o['beerType'] for o in result['offers']], ['can', 'bottle', 'bottle', 'can'])
        self.assertTrue(all('beerTypeEstimate' not in o for o in result['offers']))
