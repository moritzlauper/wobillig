import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from scraper.pizza import pizza_html, pizza_orderstar
from scraper.scrape_pizza import crawl


class PizzaProductTests(unittest.TestCase):
    def setUp(self):
        self.body = (Path(__file__).parent / 'fixtures/pizza-size-menu.html').read_bytes()
        self.url = 'https://example.org/menu/'

    def test_all_varieties_keep_same_priced_items_and_selected_size(self):
        offers = pizza_html(self.body, self.url, 'date', all_pizzas=True)
        self.assertEqual([(o['name'], o['priceChf']) for o in offers], [
            ('Pizza Margherita', 15), ('Pizza Prosciutto e Funghi', 18), ('Pizza Salami', 18)])
        self.assertEqual(offers[1]['ingredients'], 'Schinken, Pilze')
        self.assertEqual(offers[2]['ingredients'], 'Scharfe Salami')
        self.assertNotIn('ingredients', offers[0])
        self.assertTrue(all(o['priceContext'] == 'online_menu' and '32cm' in o['evidence'] for o in offers))
        self.assertTrue(all('45cm' not in o['evidence'] for o in offers))

    def test_ambiguous_unselected_and_large_sizes_are_rejected(self):
        for body in [self.body.replace(b' checked', b''), self.body.replace(b'32cm', b'45cm'),
                     self.body.replace(b'name="size"', b'name="size" checked')]:
            self.assertEqual(pizza_html(body, self.url, 'date', all_pizzas=True), [])

    def test_children_section_does_not_turn_into_regular_pizzas(self):
        self.assertEqual(pizza_html(b'<h2>Kinderpizzen</h2>' + self.body, self.url, 'date', all_pizzas=True), [])

    def test_crawl_saves_every_variety_without_ai_and_keeps_ingredients_separate(self):
        bar = {'id': '1', 'name': 'Pizza', 'website': self.url, 'offers': []}
        fetcher = Mock()
        fetcher.get.return_value = (self.url, 'text/html', self.body)
        result, check = crawl(bar, fetcher, {}, 1, [])
        self.assertEqual([o['priceChf'] for o in result['offers']], [15])
        self.assertEqual([o['name'] for o in result['pizzaMenu']], ['Pizza Prosciutto e Funghi', 'Pizza Salami'])
        self.assertEqual(check['pizzaMenuCount'], 2)
        digest = hashlib.sha256(self.body).hexdigest()
        self.assertTrue(all(o['sourceSha256'] == digest for o in result['pizzaMenu']))
        refreshed, _ = crawl(result, fetcher, {}, 1, [])
        self.assertEqual([o['ingredients'] for o in refreshed['pizzaMenu']], ['Schinken, Pilze', 'Scharfe Salami'])
        self.assertEqual(fetcher.get.call_args.args, (self.url,))

    def test_feed_keeps_all_pizzas_but_not_pasta_or_family_sizes(self):
        sizes = [{'name': '32cm', 'price': 18}, {'name': '40cm', 'price': 30}]
        data = {'isSuccessful': True, 'categories': [
            {'name': 'Pizza', 'products': [
                {'name': 'Salami', 'description': 'Scharfe Salami', 'sizes': sizes},
                {'name': 'Funghi', 'description': 'Pilze', 'sizes': sizes}]},
            {'name': 'Pasta', 'products': [{'name': 'Carbonara', 'price': 18}]},
            {'name': 'Kinder Pizza', 'products': [{'name': 'Pizza Salami', 'price': 10}]}]}
        offers = pizza_orderstar(json.dumps(data), self.url, 'date', all_pizzas=True)
        self.assertEqual([(o['name'], o['priceChf']) for o in offers], [('Salami', 18), ('Funghi', 18)])
        self.assertEqual([o['ingredients'] for o in offers], ['Scharfe Salami', 'Pilze'])

    def test_meal_cards_require_pizza_category_or_name(self):
        body = '''<div class="menucat"><h2 class="category-name">Pizza 32cm</h2>
        <div class="meal-wrapper"><h3 itemprop="name">Funghi</h3>
        <p itemprop="description">Pilze</p><p itemprop="price">18 CHF</p></div></div>
        <div class="menucat"><h2 class="category-name">Pasta</h2>
        <div class="meal-wrapper"><h3 itemprop="name">Carbonara</h3><p itemprop="price">18 CHF</p></div></div>'''
        self.assertEqual([o['name'] for o in pizza_html(body, self.url, 'date', all_pizzas=True)], ['Funghi'])

    def test_product_numbers_are_not_conflicting_prices(self):
        data = {'isSuccessful': True, 'categories': [{'name': 'Pizza', 'products': [
            {'name': '19 Pizza Prosciutto', 'price': 18},
            {'name': '20 Pizza Salami', 'price': 18}]}]}
        offers = pizza_orderstar(json.dumps(data), self.url, 'date', all_pizzas=True)
        self.assertEqual([o['name'] for o in offers], ['19 Pizza Prosciutto', '20 Pizza Salami'])
