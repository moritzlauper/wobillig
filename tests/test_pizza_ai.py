import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

from scraper.ai import BudgetExhausted, documents
from scraper.pizza_ai import PizzaAI, clean_pizzas, pizza_page
from scraper.scrape_pizza import crawl


class PizzaAITests(unittest.TestCase):
    def row(self, **changes):
        return dict(name='Margherita', priceChf=18, regular=True,
                    evidence='Margherita Tomaten, Mozzarella 18', page=1,
                    context='restaurant', **changes)

    def clean(self, **changes):
        row = {**self.row(), **changes}
        return clean_pizzas({'offers': [row]}, 'https://example.org/menu', 'today', 'sha')

    def test_only_explicit_regular_pizza_with_matching_price(self):
        offer = self.clean()[0]
        self.assertEqual((offer['priceChf'], offer['pizzaType'], offer['confidence']), (18, 'margherita', 'ai'))
        self.assertEqual(offer['sourceSha256'], 'sha')
        for changes in [dict(regular=False), dict(name='Salami'), dict(priceChf=19),
                        dict(priceChf=float('nan')), dict(page=2), dict(page=True),
                        dict(evidence='Margherita Kinderpizza 18'),
                        dict(evidence='Margherita 40 cm 18'),
                        dict(evidence='Margherita Bufala 18'),
                        dict(evidence='Margherita 18 22'), dict(context='delivery')]:
            with self.subTest(changes=changes):
                self.assertEqual(self.clean(**changes), [])

    def test_html_requires_verbatim_evidence(self):
        self.assertEqual(clean_pizzas({'offers': [self.row()]}, 'url', 'today', 'sha',
                                     source_text='Salami 18. Margherita 22'), [])

    def test_pizza_pdf_is_not_filtered_as_drinkless(self):
        from tests.test_pdf import document
        body = document([(20, 450, 'Margherita Tomaten Mozzarella 18'),
                         (20, 400, 'Pizza mit Tomaten und Mozzarella. ' * 6)])
        self.assertEqual(len(list(documents(body, 'application/pdf', page_filter=pizza_page))), 1)

    @patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-only'})
    def test_budget_cap_and_exhaustion_stop_paid_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                PizzaAI(5.01, Path(tmp))
            ai = PizzaAI(5, Path(tmp))
            with patch.object(ai.client, 'ask', side_effect=BudgetExhausted('budget_limit')) as ask:
                for _ in range(2):
                    self.assertEqual(ai.extract({'name': 'Test'}, b'<p>Margherita 18</p>',
                                                'text/html', 'url', 'today'), [])
                self.assertEqual(ask.call_count, 1)
            self.assertEqual(ai.report()['stopReason'], 'budget_limit')
            self.assertEqual(ai.report()['budgetUsd'], 5)

    def test_crawl_uses_fallback_and_preserves_identical_ai_source(self):
        url = 'https://example.org/'
        body = b'<h2>Margherita</h2><div>Tomaten</div><div>18</div>'
        bar = {'id': '1', 'name': 'Test', 'website': url, 'offers': []}
        fetcher = Mock()
        fetcher.get.return_value = (url, 'text/html', body)
        ai = Mock()
        ai.extract.return_value = clean_pizzas({'offers': [self.row()]}, url, 'original-date',
                                             hashlib.sha256(body).hexdigest())
        result, check = crawl(bar, fetcher, {}, 5, [], ai)
        self.assertEqual(result['offers'][0]['confidence'], 'ai')
        ai.extract.assert_called_once()
        # A later text-only refresh retains the original observation date.
        retained, _ = crawl(result, fetcher, {}, 5, [])
        self.assertEqual(retained['offers'], result['offers'])

    def test_fallback_cannot_bypass_branch_scope_or_review(self):
        url = 'https://example.org/'
        body = b'<h2>Margherita</h2><div>18</div>'
        bar = {'id': '1', 'name': 'Test', 'website': url, 'offers': []}
        fetcher = Mock()
        fetcher.get.side_effect = lambda requested: (requested, 'text/html', body if requested == url else b'<p>Branch</p>')
        for hints, reviews in [({'1': ['https://example.org/branch']}, []),
                               ({}, [{'url': url, 'barIds': ['1'], 'sha256': 'changed', 'offers': []}])]:
            ai = Mock()
            ai.extract.return_value = []
            result, _ = crawl(bar, fetcher, hints, 5, reviews, ai)
            self.assertTrue(all(call.args[3] != url for call in ai.extract.call_args_list))
            self.assertEqual(result['offers'], [])

    def test_pizza_only_workflow_skips_other_categories(self):
        root = Path(__file__).resolve().parents[1]
        city = (root/'.github/workflows/scrape-city.yml').read_text()
        self.assertIn("inputs.scan_mode == 'full' || inputs.scan_mode == 'pizza_only'", city)
        self.assertIn("inputs.scan_mode != 'streetfood_only' && inputs.scan_mode != 'pizza_only'", city)
