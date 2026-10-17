import hashlib
import unittest
from unittest.mock import Mock, patch

from scraper.scrape import scrape_bar


URL = 'https://bar.example/menu'
BODY = b'<p>A menu which needs visual interpretation</p>'


def offer(**values):
    return {'name': 'Lager', 'priceChf': 7, 'volumeMl': 500, 'beerType': 'bottle',
            'sourceUrl': URL, 'observedAt': '2026-10-01', 'confidence': 'ai',
            'extractionModel': 'test-model', 'sourceSha256': hashlib.sha256(BODY).hexdigest(),
            'evidence': 'Lager 5dl 7.00', **values}


def crawl(offers, body=BODY, kind='text/html', final=URL, beverage='beer'):
    fetcher = Mock()
    fetcher.get.return_value = (final, kind, body)
    bar = {'id': 'test', 'name': 'Test', 'website': URL, 'offers': offers}
    return scrape_bar(bar, fetcher, {}, 1, beverage)


class AIRefreshTests(unittest.TestCase):
    def test_unchanged_source_preserves_ai_offer_and_original_metadata(self):
        old = offer(beerTypeEstimate={'type': 'bottle', 'reason': 'Original evidence'})
        result = crawl([old])
        self.assertEqual(result['offers'], [old])
        self.assertEqual(result['scrapeStatus'], 'prices_found')

    def test_unchanged_pdf_preserves_visual_beer_and_coffee_prices(self):
        for beverage, old in [('beer', offer()), ('coffee', offer(name='Espresso', coffeeType='espresso', volumeMl=None))]:
            with patch('scraper.scrape.extract_pdf', return_value=[]), \
                 patch('scraper.scrape.coffee_pdf', return_value=[]), \
                 patch('scraper.scrape.pdf_links', return_value=[]):
                self.assertEqual(crawl([old], kind='application/pdf', beverage=beverage)['offers'], [old])

    def test_changed_or_unverifiable_ai_source_requires_review(self):
        for old in [offer(sourceSha256='different'), {k:v for k,v in offer().items() if k!='sourceSha256'}]:
            result = crawl([old])
            self.assertEqual(result['offers'], [])
            self.assertEqual(result['scrapeStatus'], 'review_required')

    def test_changed_image_does_not_keep_old_ai_price_as_unread_source(self):
        result = crawl([offer()], body=b'changed image', kind='image/png')
        self.assertEqual(result['offers'], [])
        self.assertEqual(result['scrapeStatus'], 'review_required')

    def test_same_bytes_after_redirect_preserve_original_source(self):
        old = offer()
        self.assertEqual(crawl([old], final='https://cdn.example/menu')['offers'], [old])

    def test_source_scopes_and_beer_mix_exclusions_still_apply(self):
        with patch('scraper.scrape.SOURCE_SCOPES', {'test': ['correct-branch.pdf']}):
            self.assertEqual(crawl([offer()])['offers'], [])
        with patch('scraper.scrape.SOURCE_SCOPES', {'test': ['/menu']}):
            self.assertEqual(crawl([offer()], final='https://cdn.example/wrong-branch')['offers'], [])
        self.assertEqual(crawl([offer(name='Panache')])['offers'], [])

    def test_exclusive_review_takes_precedence_over_ai(self):
        for digest in (hashlib.sha256(BODY).hexdigest(), 'changed'):
            review = {'barId': 'test', 'sha256': digest, 'exclusive': True, 'offers': []}
            with patch('scraper.scrape.REVIEWED_MENUS', {URL: review}):
                self.assertEqual(crawl([offer()])['offers'], [])

    def test_matching_text_extraction_keeps_ai_metadata_without_duplicate(self):
        old = offer()
        parsed = {**old, 'confidence': 'parsed', 'observedAt': '2026-10-17'}
        with patch('scraper.scrape.extract_offers', return_value=[parsed]):
            self.assertEqual(crawl([old])['offers'], [old])

    def test_changed_source_can_replace_old_price_with_new_text_evidence(self):
        result = crawl([offer()], body=b'<p>Lager 5dl 8.00</p>')
        self.assertEqual([o['priceChf'] for o in result['offers']], [8])

