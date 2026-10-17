import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from scraper.extract import extract_offers
from scraper.scrape import Fetcher, html_content, public_url, scrape_bar, prioritize_links, main

class ExtractionTests(unittest.TestCase):
    def offers(self,text):
        return extract_offers(text,'https://bar.example/menu','2026-10-14T12:00:00Z')

    def test_swiss_prices_and_units(self):
        offers=self.offers('Quöllfrisch 3 dl CHF 5.50 | 5 dl CHF 8.00\nLager 33cl 6.–\nPils 0,5 l 7,50')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(300,5.5),(500,8),(330,6),(500,7.5)])

    def test_regional_bottle_beers_without_generic_beer_word(self):
        offers=self.offers('Flaschenbiere\nFelsenau Bärner Müntschi 33cl 6\nUeli Reverenz 33cl 6.50\nKitchen Brew 33cl 7.50\nEgger 33cl 5.50')
        self.assertEqual([(o['volumeMl'],o['priceChf'],o['beerType']) for o in offers],
                         [(330,6,'bottle'),(330,6.5,'bottle'),(330,7.5,'bottle'),(330,5.5,'bottle')])
        for line in ['Felsenau Bierschnaps 2cl 8.00', 'Ueli Bierbrand 2cl 8.00',
                     'Felsenau Panaché 33cl 6.00', 'Kitchen Brew Ginger Beer 33cl 6.00',
                     'Ueli 6x 33cl 20.00', 'Felsenau 4.8% 6.00']:
            self.assertEqual(self.offers('Flaschenbiere\n'+line),[],line)

    def test_alcohol_free_name_does_not_hide_abv_after_size(self):
        offers=self.offers('Flaschenbiere\nFeldschlösschen Alkoholfrei 33cl 0.5 % 7.00')
        self.assertEqual([(o['volumeMl'],o['priceChf'],o['alcoholFree']) for o in offers],[(330,7,True)])
        self.assertTrue(self.offers('Rothaus Tannenzäpfle Alk.frei Flasche 33cl 6.50')[0]['alcoholFree'])

    def test_swiss_bottle_heading(self):
        text,_=html_content('<h3>Fläsche</h3><table><tr><td>Feldschlösschen Lager</td><td>33 cl</td><td>5.00</td></tr></table>'.encode(),'url')
        self.assertEqual({o['beerType'] for o in self.offers(text)},{'bottle'})

    def test_drinks_link_labels_and_encoded_paths(self):
        body='<a href="/food.pdf">Speisekarte</a><a href="/files/123.pdf">Getränkekarte</a><a href="/trinken">Trinken</a><a href="/getr%C3%A4nke">Angebot</a>'
        labels={}
        _,links=html_content(body.encode(),'https://bar.example',link_labels=labels)
        self.assertEqual(links[0],'https://bar.example/files/123.pdf')
        self.assertIn('https://bar.example/trinken',links)
        self.assertIn('https://bar.example/getr%C3%A4nke',links)
        self.assertEqual(prioritize_links(list(reversed(links)),labels=labels)[-1],
                         'https://bar.example/food.pdf')

    def test_product_card_category_after_price_stays_with_its_product(self):
        body='''<article><div><h3>Ueli Bier (33cl)</h3><span>CHF 6.50</span></div><p>Array</p><span>Offenbier</span></article>
        <article><div><h3>Red Stripe (33cl)</h3><span>CHF 8</span></div><span>Flaschenbier</span></article>
        <article><div><h3>Moretti (33cl)</h3><span>CHF 7</span></div></article>'''
        text,_=html_content(body.encode(),'https://bar.example')
        offers=self.offers(text)
        self.assertIn(('Ueli Bier','draft'),[(o['name'],o['beerType']) for o in offers])
        self.assertIn(('Red Stripe','bottle'),[(o['name'],o['beerType']) for o in offers])
        self.assertNotIn(('Moretti','bottle'),[(o['name'],o['beerType']) for o in offers])

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

class BarCoverageRegressionTests(unittest.TestCase):
    def test_deep_bottle_search_also_visits_existing_draft_prices(self):
        bars=[{'id':str(i),'name':str(i),'type':'bar','website':'https://bar.example','checkedAt':None,
               'offers':offers} for i,offers in enumerate([
                   [], [{'beerType':'draft'}], [{'beerType':'bottle'}],
                   [{'beerType':'unknown','beerTypeEstimate':{'type':'bottle'}}]])]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bars.json';path.write_text(json.dumps({'bars':bars}))
            def result(bar,*args):
                return {**bar,'scrapeStatus':'no_prices'}
            with patch('sys.argv',['scrape','--missing-bottles','--max-pages','20']), \
                 patch('scraper.scrape.DATA',path), patch('scraper.scrape.write'), \
                 patch('scraper.scrape.Fetcher'), patch('scraper.scrape.beer_menu_hints',return_value={}), \
                 patch('scraper.scrape.scrape_bar',side_effect=result) as scrape, patch('builtins.print'):
                main()
            self.assertEqual({call.args[0]['id'] for call in scrape.call_args_list},{'0','1'})
            self.assertTrue(all(call.args[3]==20 for call in scrape.call_args_list))

    def test_larger_pdf_limit_stays_bounded_and_does_not_apply_to_html(self):
        response=MagicMock()
        response.__enter__.return_value=response
        response.is_redirect=False
        response.status_code=200
        with patch('scraper.scrape.public_url'), patch('scraper.scrape.requests.get',return_value=response), patch('scraper.scrape.MAX_BYTES',8), patch('scraper.scrape.MAX_PDF_BYTES',24):
            fetcher=Fetcher()
            response.headers={'Content-Type':'application/pdf'}
            response.iter_content.return_value=[b'x'*12]
            self.assertEqual(len(fetcher.raw('https://bar.example/menu.pdf',delay=0)[2]),12)
            response.iter_content.return_value=[b'x'*25]
            with self.assertRaisesRegex(ValueError,'response_too_large'):
                fetcher.raw('https://bar.example/menu.pdf',delay=0)
            response.headers={'Content-Type':'text/html'}
            response.iter_content.return_value=[b'x'*12]
            with self.assertRaisesRegex(ValueError,'response_too_large'):
                fetcher.raw('https://bar.example/',delay=0)

    def test_www_alias_menu_links(self):
        _, links = html_content(b'<a href="https://bar.example/angebot">Angebot</a><a href="https://evilbar.example/menu">Menu</a>', 'https://www.bar.example/')
        self.assertEqual(links, ['https://bar.example/angebot'])

    def test_combined_wine_drinks_card_is_not_discarded(self):
        _, links = html_content(b'<a href="/Canvas_Bar_Wine_Spirits_Softdrinks.pdf">Drinks &amp; Weinkarte</a><a href="/catering.pdf">Catering</a>', 'https://bar.example/')
        self.assertEqual(links, ['https://bar.example/Canvas_Bar_Wine_Spirits_Softdrinks.pdf'])

    def test_cocktail_page_can_lead_to_full_bar_card(self):
        _, links = html_content(b'<a href="/rare-cocktails/">Read More</a>', 'https://bar.example/')
        self.assertEqual(links, ['https://bar.example/rare-cocktails/'])

    def test_portion_before_product(self):
        offers = extract_offers('BIER VOM FASS\n30 cl Birra Moretti 6.9\n50 cl Birra Moretti 10.5\n33 cl Ginger Beer 7', 'https://bar.example/menu.pdf', '2026-10-15')
        self.assertEqual([(o['volumeMl'], o['priceChf'], o['beerType']) for o in offers], [(300, 6.9, 'draft'), (500, 10.5, 'draft')])
        self.assertEqual(offers[0]['evidence'], '30 cl Birra Moretti 6.9')
        self.assertEqual(extract_offers('30 cl 5.00 Lager 8.00', 'https://bar.example', '2026-10-15'), [])

    def test_structural_product_and_portions(self):
        body='<p>Hürlimann offen</p><p>2 dl / 3 dl / 5 dl 3.5 / 5.5 / 7.5</p><p>Softdrinks</p><p>5 dl 4.50</p>'
        text,_=html_content(body.encode(),'https://bar.example')
        offers=extract_offers(text,'https://bar.example','2026-10-15')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(200,3.5),(300,5.5),(500,7.5)])

    def test_failed_menu_is_preserved_alongside_successful_menu(self):
        old=extract_offers('Lager 5dl 7.00','https://bar.example/old.pdf','2026-09-01')
        bar={'id':'node/test','website':'https://bar.example/','offers':old}
        class Fetch:
            def get(self,url):
                if url.endswith('old.pdf'):raise ValueError('http_503')
                return url,'text/html',b'<p>IPA 3dl 6.00</p>'
        result=scrape_bar(bar,Fetch(),{},3)
        self.assertEqual(len(result['offers']),2)
        retained=next(o for o in result['offers'] if o['volumeMl']==500)
        self.assertEqual(retained['observedAt'],'2026-09-01')

    def test_kunsthaus_line_break_menu(self):
        body='<p>HÜRLIMANN OFFEN<br/>2 DL / 3 DL / 5 DL 3.5 / 5.5 / 7.5<br/>SCHNEIDER’S WEISSE 3.3 DL 7<br/>BROOKLYN EAST IPA 3.3 DL 8</p><p>Cola<br/>5 dl 4.50</p>'
        text,_=html_content(body.encode(),'https://bar.example')
        offers=extract_offers(text,'https://bar.example','2026-10-15')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(200,3.5),(300,5.5),(500,7.5),(330,7),(330,8)])

    def test_bounded_scan_preserves_unvisited_source(self):
        old=extract_offers('Lager 5dl 7.00','https://bar.example/old','2026-09-01')
        bar={'id':'node/test','website':'https://bar.example/','offers':old}
        class Fetch:
            def get(self,url):return url,'text/html',b'<p>No current menu here</p>'
        result=scrape_bar(bar,Fetch(),{'node/test':['https://bar.example/hint']},1)
        self.assertEqual(result['offers'],old)
        result=scrape_bar(bar,Fetch(),{},1)
        self.assertEqual(result['offers'],[])

    def test_empty_source_is_removed_even_when_another_source_fails(self):
        old=extract_offers('Lager 5dl 7.00','https://bar.example/old','2026-09-01')
        old+=extract_offers('IPA 3dl 6.00','https://bar.example/offline','2026-09-01')
        bar={'id':'node/test','website':None,'offers':old}
        class Fetch:
            def get(self,url):
                if url.endswith('offline'):raise ValueError('http_503')
                return url,'text/html',b'<p>No current menu</p>'
        result=scrape_bar(bar,Fetch(),{},2)
        self.assertEqual(result['offers'],old[1:])
        self.assertEqual(result['scrapeStatus'],'partial')

if __name__=='__main__': unittest.main()


class RobotsAvailabilityTests(unittest.TestCase):
    def test_missing_robots_on_asset_cdn_does_not_block_public_menu(self):
        from scraper.scrape import UA
        for code in (403, 404, 410):
            fetcher = Fetcher()
            with patch.object(fetcher, 'raw', return_value=(code, {}, b'AccessDenied')):
                self.assertTrue(fetcher.policy('https://cdn.example/menu.pdf').can_fetch(UA, 'https://cdn.example/menu.pdf'))

    def test_real_disallow_rate_limits_and_server_errors_stay_blocked(self):
        from scraper.scrape import UA
        for code, body in [(200, b'User-agent: *\nDisallow: /'), (429, b''), (503, b'')]:
            fetcher = Fetcher()
            with patch.object(fetcher, 'raw', return_value=(code, {}, body)):
                self.assertFalse(fetcher.policy('https://example.org/menu.pdf').can_fetch(UA, 'https://example.org/menu.pdf'))
