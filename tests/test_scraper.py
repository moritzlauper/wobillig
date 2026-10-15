import unittest
from unittest.mock import patch
from scraper.extract import extract_offers
from scraper.scrape import html_content, public_url, scrape_bar

class ExtractionTests(unittest.TestCase):
    def offers(self,text):
        return extract_offers(text,'https://bar.example/menu','2026-10-14T12:00:00Z')

    def test_swiss_prices_and_units(self):
        offers=self.offers('Quöllfrisch 3 dl CHF 5.50 | 5 dl CHF 8.00\nLager 33cl 6.–\nPils 0,5 l 7,50')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(300,5.5),(500,8),(330,6),(500,7.5)])

    def test_no_prices_from_soft_drinks_or_percentages(self):
        for line in ['Coca-Cola 0.5 l 5.00','Lager 0.5 l 4.8%','Lager 5 dl','Lager 5 dl 80.00','Happy Hour Lager 3 dl 4.50','Lager 5 dl 4.50 / 7.50']:
            self.assertEqual(self.offers(line),[],line)

    def test_no_cross_row_guessing(self):
        self.assertEqual(self.offers('Lager\n0.5 l\n7.50'),[])

    def test_pdf_adjacent_second_size(self):
        text='Feldschlösschen Original (Lager) 3 dl 4.50\n5 dl 6.80\nCola\n5 dl 4.00'
        offers=extract_offers(text,'https://example.com/menu.pdf','2026-10-14',continuations=True)
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(300,4.5),(500,6.8)])
        self.assertIn('3 dl 4.50 / 5 dl 6.80',offers[1]['evidence'])
        self.assertEqual(len(self.offers(text)),1)

    def test_pdf_continuation_keeps_alcohol_metadata(self):
        offers=extract_offers('Lager 0.5% 3dl 5.00\n5dl 7.00','https://example.com/menu.pdf','2026-10-14',continuations=True)
        self.assertEqual(len(offers),2)
        self.assertTrue(all(o['alcoholFree'] for o in offers))

    def test_parallel_sizes_and_prices(self):
        offers=self.offers('Adler Lager 4.8% Vol. 2dl / 3dl / 5dl 4.00 / 5.00 / 7.50')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(200,4),(300,5),(500,7.5)])
        self.assertEqual(self.offers('Lager 3dl / 5dl 5.00 / 7.00 / 9.00'),[])

    def test_beer_heading_for_generic_serving_names(self):
        text,_=html_content('<h5>Appenzeller-Bier fliessend</h5><div>Grosses 5 dl 8.50</div><h5>Softdrinks</h5><div>Grosses 5 dl 4.00</div>'.encode(),'https://example.com')
        offers=self.offers(text)
        self.assertEqual(len(offers),1)
        self.assertEqual(offers[0]['priceChf'],8.5)

    def test_beer_hostname_does_not_turn_every_link_into_menu(self):
        _,links=html_content(b'<a href="/about">Team</a><a href="/drinks.pdf">Karte</a>','https://bier.example')
        self.assertEqual(links,['https://bier.example/drinks.pdf'])

    def test_embedded_pdf_viewer_discovers_menu_without_executing_script(self):
        body = br'<script class="df-shortcode-script">window.option_df_1={"source":"https:\/\/cdn.example\/Getraenke.pdf"}; arbitraryCode();</script>'
        _, links = html_content(body, 'https://bar.example')
        self.assertEqual(links, ['https://cdn.example/Getraenke.pdf'])
        for value in ['javascript:alert(1)', 'file:///menu.pdf', 'https://example.org/press.pdf']:
            _, links = html_content(('<script class="df-shortcode-script">{"source":"' + value + '"}</script>').encode(), 'https://bar.example')
            self.assertEqual(links, [])

    def test_merged_menu_rows_and_ginger_beer_rejected(self):
        for text in ['Ginger Beer 3 dl 5.00','Goba Citro 3dl 5.00 Lager 5dl 7.00','Lager 3dl 5.00 Cola 5dl 7.00','Appenzeller 29% 2cl 5.50 Wein 1dl 8.00','MOSCOW MULE 17.5 BROOKLYN IPA 3.3dl 9.0','Mythos, Suisse, 13% 9 | 58 Rekord Amber, 5% 3.3 dl 7.5']:
            self.assertEqual(self.offers(text),[],text)

    def test_whole_francs_and_low_alcohol(self):
        self.assertEqual(self.offers('Feldschlösschen 0.5L CHF 8')[0]['priceChf'],8)
        self.assertTrue(self.offers('IPA Appenzeller < 0,5% vol 3 dl 6.00')[0]['alcoholFree'])

    def test_alcohol_free_and_duplicates(self):
        o=self.offers('Feldschlösschen alkoholfrei 0.33l 5.50\nFeldschlösschen alkoholfrei 0.33l 5.50')
        self.assertEqual(len(o),1)
        self.assertTrue(o[0]['alcoholFree'])

    def test_html_rows(self):
        text,links=html_content(b'<table><tr><td>Lager</td><td>5 dl</td><td>7.50</td></tr></table><a href="/drinks.pdf">Karte</a>','https://example.com')
        self.assertEqual(self.offers(text)[0]['priceChf'],7.5)
        self.assertEqual(links,['https://example.com/drinks.pdf'])

    def test_private_hosts_rejected(self):
        for url in ['file:///etc/passwd','http://127.0.0.1/menu','http://[::1]/menu','https://user:pass@example.com']:
            with self.assertRaises(ValueError):
                public_url(url)

    def test_failed_scrape_keeps_old_price_date(self):
        bar={'id':'node/1','website':'https://example.com','offers':self.offers('Lager 5 dl 7.50')}
        class Failing:
            def get(self,url): raise ValueError('robots_blocked')
        result=scrape_bar(bar,Failing(),{},3)
        self.assertEqual(result['offers'],bar['offers'])
        self.assertEqual(result['scrapeStatus'],'robots_blocked')

if __name__=='__main__': unittest.main()
