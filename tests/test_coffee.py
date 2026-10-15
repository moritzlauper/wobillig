import json
from pathlib import Path
import tempfile
import unittest
from scraper.coffee import extract_coffees, coffee_pdf, coffee_types
from scraper.scrape import html_content, scrape_bar, source_allowed
from scraper.scrape_coffee import ArchiveFetcher
from test_pdf import document


class CoffeeTests(unittest.TestCase):
    def parse(self, text):
        return extract_coffees(text, 'https://example.com/menu', '2026-10-15')

    def test_shared_price_and_no_invented_volume(self):
        offers=self.parse('Kaffee / Espresso / Ristretto CHF 4.50')
        self.assertEqual({o['coffeeType'] for o in offers}, {'creme','espresso','ristretto'})
        self.assertTrue(all(o['priceChf']==4.5 and o['volumeMl'] is None for o in offers))
        self.assertEqual(self.parse('Kaffee 4.50')[0]['name'], 'Kaffee')
        self.assertEqual(self.parse('Kaffee Espresso 4.50'), [])

    def test_double_and_milk_coffees_keep_their_category(self):
        for text in ['Doppio Espresso 6.50', 'Espresso doppio 6.50', 'Doppelter Espresso 6.50']:
            self.assertEqual([(o['coffeeType'],o['priceChf']) for o in self.parse(text)], [('double',6.5)])
        self.assertEqual(coffee_types('Caffè Latte'), ['milk'])
        self.assertEqual(coffee_types('Latte Macchiato'), ['latte'])
        self.assertEqual(coffee_types('Milchkaffee «Schale»'), ['milk'])

    def test_explicit_alternative_prices_keep_printed_order(self):
        self.assertEqual([(o['coffeeType'],o['priceChf']) for o in self.parse('Espresso / Doppio 4.70 / 5.70')], [('espresso',4.7),('double',5.7)])
        for line in ['Espresso / Doppio 4.70 5.70', 'Espresso 4.70 / 5.70', 'Espresso / Doppio / Cappuccino 4.70 / 5.70']:
            self.assertEqual(self.parse(line), [], line)

    def test_supplements_cocktails_iced_and_combos_are_not_standard_coffee(self):
        for line in ['Extra Espresso 2.00', '+ Espresso 2.00', 'Espresso Martini 12', 'Kafi Luz 6.50', 'Iced Cappuccino 6', 'Cappuccino auf Eis 5.50', 'Gipfeli und Kaffee 5', 'Espresso oder Kaffee zum Menü 3.50', 'CAPPUCCINO. 2']:
            self.assertEqual(self.parse(line), [], line)

    def test_currency_leaders_and_spaced_decimal(self):
        self.assertEqual(self.parse('Café crème ........ 4 .90')[0]['priceChf'],4.9)
        self.assertEqual(self.parse('Espresso 4.–')[0]['priceChf'],4)
        self.assertEqual(self.parse('Cappuccino 5,50 CHF')[0]['priceChf'],5.5)

    def test_pdf_price_alignment_and_footer_not_a_price(self):
        body=document([(20,450,'Espresso'),(220,450,'4.50'),(20,420,'Cappuccino'),(20,405,'5.50'),(20,47,'LATTE MACCHIATO'),(20,30,'2')])
        offers=coffee_pdf(body,'https://example.com/menu.pdf','2026-10-15')
        self.assertEqual([(o['coffeeType'],o['priceChf']) for o in offers],[('espresso',4.5),('cappuccino',5.5)])
        self.assertTrue(all(o['evidence'].startswith('PDF S. 1:') for o in offers))

    def test_html_adjacency_and_beer_coffee_isolation(self):
        html=b'<div><p>Cappuccino</p><div>5.50</div></div><p>Lager 5dl 7.00</p>'
        class Fetcher:
            def get(self,url):return url,'text/html',html
        bar={'id':'node/0','website':'https://example.com/','offers':[]}
        coffee=scrape_bar(bar,Fetcher(),{},1,'coffee')
        beer=scrape_bar(bar,Fetcher(),{},1)
        self.assertEqual([o['coffeeType'] for o in coffee['offers']], ['cappuccino'])
        self.assertEqual([o['priceChf'] for o in beer['offers']], [7])
        self.assertTrue(all('coffeeType' not in o for o in beer['offers']))

    def test_coffee_branch_and_lunch_scopes(self):
        self.assertFalse(source_allowed('node/370657577','https://example.com/Menu_VD_web.pdf','coffee'))
        self.assertTrue(source_allowed('node/370657577','https://example.com/_Menu_ZH_web.pdf','coffee'))
        self.assertFalse(source_allowed('node/503668298','https://www.fuerdich.ch/damm-drinks','coffee'))
        self.assertFalse(source_allowed('node/0','https://example.com/Wochenmenue.pdf','coffee'))
        self.assertTrue(source_allowed('node/0','https://example.com/Wochenmenue.pdf','beer'))

    def test_archive_retains_actual_date_and_redirect(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'a.json'
            file.write_text(json.dumps({'url':'https://example.com/menu','requestedUrl':'http://www.example.com/menu/','kind':'text/html','observedAt':'2026-10-14T12:00:00Z'}))
            file.with_suffix('.body').write_bytes(b'<p>Espresso 4.50</p>')
            fetcher=ArchiveFetcher([folder])
            final,kind,body=fetcher.get('http://www.example.com/menu/')
            self.assertEqual(fetcher.docs[final]['stamp'],'2026-10-14T12:00:00Z')
            self.assertEqual(kind,'text/html')
            self.assertIn(b'Espresso',body)
