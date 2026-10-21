import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

from scraper.ai import BudgetExhausted, documents
from scraper.pizza_ai import PizzaAI, clean_pizzas, pizza_page
from scraper.scrape_pizza import crawl, resolve_pizza_menu


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

    def other_row(self, **changes):
        return {**self.row(), 'name': 'Pizza Funghi', 'pizzaType': 'other', 'isPizza': True,
                'menuSection': 'Pizza', 'ingredients': 'Tomaten, Mozzarella, Pilze',
                'evidence': 'Pizza Funghi Tomaten, Mozzarella, Pilze 18', **changes}

    def test_other_pizzas_and_ingredients_require_source_evidence(self):
        row = self.other_row()
        offer = clean_pizzas({'offers': [row]}, 'url', 'date', 'sha', source_text=row['evidence'])[0]
        self.assertEqual((offer['name'], offer['pizzaType'], offer['ingredients']),
                         ('Pizza Funghi', 'other', 'Tomaten, Mozzarella, Pilze'))
        row['ingredients'] = 'Trüffel'
        self.assertNotIn('ingredients', clean_pizzas({'offers': [row]}, 'url', 'date', 'sha')[0])
        for changes in [dict(isPizza=False), dict(menuSection='Pasta'), dict(priceChf=19),
                        dict(evidence='Pizza Funghi 18 22'), dict(evidence='Pizza Funghi 40 cm 18'),
                        dict(evidence='Pizza Funghi Kinder 18'), dict(name='Spaghetti', evidence='Spaghetti 18')]:
            with self.subTest(changes=changes):
                self.assertEqual(clean_pizzas({'offers': [self.other_row(**changes)]}, 'url', 'date', 'sha'), [])

    def test_ingredient_free_pizza_keeps_price_without_guessing_toppings(self):
        row = self.other_row(name='Pizza Salami', evidence='Pizza Salami 18', ingredients=None)
        offer = clean_pizzas({'offers': [row]}, 'url', 'date', 'sha')[0]
        self.assertEqual(offer['priceChf'], 18)
        self.assertNotIn('ingredients', offer)

    def test_separate_pizzas_do_not_conflict_or_change_margherita(self):
        url = 'https://example.org/'
        body = b'<h1>Pizza</h1><p>Margherita 18</p>'
        bar = {'id': '1', 'name': 'Test', 'website': url, 'offers': []}
        fetcher = Mock(); fetcher.get.return_value = (url, 'text/html', body)
        ai = Mock()
        digest = hashlib.sha256(body).hexdigest()
        ai.extract.return_value = clean_pizzas({'offers': [self.other_row(), self.other_row(
            name='Pizza Salami', priceChf=22, evidence='Pizza Salami 22', ingredients=None)]}, url, 'date', digest)
        result, check = crawl(bar, fetcher, {}, 5, [], ai)
        self.assertEqual([o['priceChf'] for o in result['offers']], [18])
        self.assertEqual([o['priceChf'] for o in result['pizzaMenu']], [18, 22])
        self.assertEqual(check['status'], 'prices_found')
        retained, _ = crawl(result, fetcher, {}, 5, [])
        self.assertEqual(retained['pizzaMenu'], result['pizzaMenu'])
        fetcher.get.return_value = (url, 'text/html', body+b' updated')
        changed, _ = crawl(result, fetcher, {}, 5, [])
        self.assertEqual(changed['pizzaMenu'], [])

    def test_conflicts_are_per_named_pizza_and_restaurant_prices_win(self):
        one = clean_pizzas({'offers': [self.other_row()]}, 'url', 'date', 'sha')[0]
        menu, conflicts = resolve_pizza_menu([one, {**one, 'name': 'Funghi', 'priceChf': 21},
                                              {**one, 'name': 'Pizza Salami', 'priceChf': 22}])
        self.assertEqual([o['name'] for o in menu], ['Pizza Salami'])
        self.assertEqual(len(conflicts), 1)
        menu, conflicts = resolve_pizza_menu([one, {**one, 'priceChf': 15, 'priceContext': 'online_menu'}])
        self.assertEqual([o['priceChf'] for o in menu], [18])
        self.assertEqual(conflicts, [])

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
        self.assertIn("inputs.scan_mode != 'pizza_only'", city)
