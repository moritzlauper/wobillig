import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from scraper.enrich import candidates
from scraper.scrape import discover, html_content, source_allowed, beer_menu_hints
from scraper.extract import extract_offers
from scraper.pdf_extract import extract_pdf
from test_pdf import document


def venue(id, name, website):
    return {'id':id,'name':name,'website':website,'lat':47.37,'lon':8.53}


class EnrichmentTests(unittest.TestCase):
    def test_beer_search_reuses_coffee_sources_with_branch_scopes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'scraper').mkdir()
            (root/'scraper/menu_urls.json').write_text(json.dumps({'node/1':['https://bar.example/beer.pdf']}))
            (root/'scraper/coffee_menu_urls.json').write_text(json.dumps({'node/1':['https://bar.example/drinks.pdf']}))
            (root/'coffee.json').write_text(json.dumps({'bars':[
                {'id':'node/1','offers':[{'sourceUrl':'https://bar.example/drinks.pdf'},
                    {'sourceUrl':'https://bar.example/other-branch.pdf'},
                    {'sourceUrl':'https://maps.example/photo','photoSource':{'date':'2026-10'}}]},
                {'id':'node/2','offers':[{'sourceUrl':'https://bar.example/other-branch.pdf'}]},
            ]}))
            scopes={'node/1':['beer.pdf','drinks.pdf'],'node/2':['correct-branch.pdf']}
            with patch('scraper.scrape.ROOT',root), patch('scraper.scrape.DATA_DIR',root), patch('scraper.scrape.COFFEE_SOURCE_SCOPES',scopes):
                hints=beer_menu_hints()
            self.assertEqual(hints,{'node/1':['https://bar.example/beer.pdf','https://bar.example/drinks.pdf']})

    def test_candidate_rotation_and_shared_branch_guard(self):
        existing=[venue('node/1','Existing','https://chain.example/a')]
        found=[venue('node/2','Other branch','https://chain.example/b'),venue('node/3','Checked','https://checked.example'),venue('node/4','New','https://new.example'),venue('node/5','No site',None)]
        selected=candidates(found,existing,{}, {'node/3':{'checkedAt':'2026-10-15'}})
        self.assertEqual([b['id'] for b in selected],['node/4','node/3'])
        self.assertIn('node/2',[b['id'] for b in candidates(found,existing,{'node/2':['https://chain.example/b.pdf']},{})])

    def test_refresh_retains_discovered_restaurants_inside_city(self):
        class Response:
            def raise_for_status(self):pass
            def json(self):return {'elements':[{'type':'node','id':9,'lat':47.37,'lon':8.53,'tags':{'name':'New restaurant','amenity':'restaurant'}}]}
        previous={'bars':[{'id':'node/9','type':'restaurant','offers':[]}]}
        with patch('scraper.scrape.requests.get',return_value=Response()) as get:
            result=discover(previous)
        self.assertIn('node(9)(area.city);',get.call_args.kwargs['params']['data'])
        self.assertEqual(result['bars'][0]['id'],'node/9')

    def test_grid_menu_pairs_only_adjacent_product_and_price(self):
        body=b'<div><div><div>Sprint Lager (ZH) 5.2% (0.5L)</div></div><div><div>8.5 CHF</div></div><div>Cola 0.5L</div><div>5 CHF</div></div>'
        text,_=html_content(body,'https://example.com')
        offers=extract_offers(text,'url','today')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(500,8.5)])
        text,_=html_content(b'<div>Lager 5dl</div><div>Cola</div><div>5 CHF</div>','url')
        self.assertEqual(extract_offers(text,'url','today'),[])

    def test_brand_water_cocktails_and_mixed_alcohol_flags_rejected(self):
        for line in ['Appenzeller, Laut / Still 5dl 6.00','Weissbier Aperitivo 5dl 13.50','Picon Lager 5dl 9.00','Appenzeller Weizen mit/ohne 5dl 8.60','Mini-Degu Lager 5dl 8.00']:
            self.assertEqual(extract_offers(line,'url','today'),[],line)

    def test_portion_brackets_and_leaders(self):
        offers=extract_offers('Lager (0.5L) .... 7.50 CHF\nBier Lager 5 DL (Flasche) . . . . 6.80','url','today')
        self.assertEqual([(o['volumeMl'],o['priceChf']) for o in offers],[(500,7.5),(500,6.8)])

    def test_wrapped_abv_under_explicit_portion_header(self):
        body=document([(100,470,'50cl / 25cl'),(100,440,'HURLIMANN LAGER BEER'),(100,425,'4.8 %............. 9.10 / 5.60'),(100,400,'GUINNESS'),(100,385,'0.0 %............. 44cl 8.60')])
        offers=extract_pdf(body,'url','today')
        self.assertEqual([(o['volumeMl'],o['priceChf'],o['alcoholFree']) for o in offers],[(500,9.1,False),(250,5.6,False),(440,8.6,True)])

    def test_named_product_is_not_a_portion_header(self):
        body=document([(20,450,'Amboss Weizen Bier'),(300,450,'5dl'),(20,420,'Appenzeller Panache'),(300,420,'5.50')])
        self.assertEqual(extract_pdf(body,'url','today'),[])

    def test_adjacent_tables_cannot_share_prices(self):
        body=document([(20,450,'Bier'),(150,450,'30cl'),(200,450,'50cl'),(270,450,'Biere'),(400,450,'33cl'),(20,420,'Lager'),(150,420,'5.50'),(200,420,'8.00'),(270,420,'Weizen'),(400,420,'7.00')])
        offers=extract_pdf(body,'url','today')
        self.assertNotIn(('Lager',330,7),[(o['name'],o['volumeMl'],o['priceChf']) for o in offers])

    def test_delivery_menu_excluded_from_on_site_prices(self):
        self.assertFalse(source_allowed('node/1','https://example.com/bestellen/getraenke/'))
        self.assertFalse(source_allowed('node/1','https://example.com/casino_bern_event_wein_und_getraenkekarte.pdf'))
        self.assertTrue(source_allowed('node/1','https://example.com/menu/'))
        text,_=html_content(b'<title>Restaurant - Essen online bestellen</title><div>Lager 5dl 5.00</div>','https://example.com')
        self.assertEqual(text,'')

    def test_takeaway_section_excludes_nested_rows_only(self):
        text,_=html_content(b'<h2>Take Away Bier</h2><div><p>Lager 5dl 5.00</p></div><h2>Flaschenbier</h2><p>Lager 5dl 8.00</p>','https://example.com')
        self.assertEqual([o['priceChf'] for o in extract_offers(text,'url','today')],[8])
