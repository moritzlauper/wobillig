import hashlib
import unittest
from unittest.mock import patch
from scraper.menu_dates import verified_menu_date
from scraper.scrape import scrape_bar


class MenuDateTests(unittest.TestCase):
    body = b'<p>Preise gueltig ab 17.10.2026</p>'

    def review(self, **patches):
        return {'barId': 'test', 'sha256': hashlib.sha256(self.body).hexdigest(),
                'menuDate': {'date': '2026-10-17', 'evidence': 'Preise gueltig ab 17.10.2026'},
                'offers': [], **patches}

    def test_only_unchanged_reviewed_document_gets_date_evidence(self):
        proof = verified_menu_date(self.review(), self.body, '2026-10-20')
        self.assertEqual(proof['verifiedMenuDate']['date'], '2026-10-17')
        self.assertEqual(proof['verifiedMenuDate']['sha256'], hashlib.sha256(self.body).hexdigest())
        self.assertEqual(verified_menu_date(self.review(), self.body+b' changed', '2026-10-20'), {})

    def test_missing_ambiguous_and_future_dates_cannot_authorize_replacement(self):
        for value in [None, {}, {'date': '2026-10-17', 'evidence': ''},
                      {'date': '2026-10', 'evidence': 'October'},
                      {'date': '2026-02-30', 'evidence': 'invalid'},
                      {'date': '2026-10-21', 'evidence': 'future'}]:
            self.assertEqual(verified_menu_date(self.review(menuDate=value), self.body, '2026-10-20'), {})

    def test_scraper_carries_proof_only_with_matching_review(self):
        offer = {'name': 'Lager', 'volumeMl': 300, 'priceChf': 6, 'beerType': 'draft', 'alcoholFree': False}
        review = self.review(offers=[offer])
        bar = {'id': 'test', 'website': 'https://example.org/menu', 'offers': []}
        class Fetch:
            def get(inner, url): return url, 'text/html', self.body
        with patch('scraper.scrape.REVIEWED_MENUS', {bar['website']: review}), patch('scraper.scrape.now', return_value='2026-10-20'):
            result = scrape_bar(bar, Fetch(), {}, 1)
        self.assertEqual(result['offers'][0]['verifiedMenuDate']['date'], '2026-10-17')
        self.assertEqual(result['offers'][0]['confidence'], 'reviewed')
