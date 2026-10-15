import copy
import json
from pathlib import Path
import unittest
from scraper.beer_rules import is_beer_mix
from scraper.estimates import estimate_types
from scraper.extract import extract_offers
from scraper.ai import clean_offers
from scraper.ai_scan import merge_offers
from scraper.pdf_extract import extract_pdf
from scraper.scrape import scrape_bar
from test_pdf import document
from test_ai import offer
import test_ai

CASES = json.loads((Path(__file__).parent / 'fixtures/beer-mixes.json').read_text())

class BeerRulesTests(unittest.TestCase):
    def test_shared_product_cases(self):
        for name in CASES['excluded']:
            self.assertTrue(is_beer_mix(name), name)
            self.assertEqual(extract_offers('Offenbier\n'+name+' 3dl 5', 'url', 'today'), [], name)
            row=test_ai.AITests().row(name=name, evidence=name+' 5dl 8', beerType='draft')
            self.assertEqual(clean_offers({'offers':[row]}, 'url', 'today'), [], name)
        for name in CASES['beer']:
            self.assertFalse(is_beer_mix(name), name)

    def test_mixes_cannot_return_through_old_or_reviewed_offers(self):
        mix={**offer(), 'name':'Panash', 'beerType':'draft'}
        lager=offer()
        self.assertEqual(merge_offers([mix,lager],[mix]), [lager])
        bars=[{'offers':[mix,lager]}]
        estimate_types(bars)
        self.assertEqual(bars[0]['offers'], [lager])
        class Fetch:
            def get(self,url):return url,'text/html',b'<p>No menu</p>'
        result=scrape_bar({'id':'test','website':'https://example.com','offers':[mix]},Fetch(),{},1)
        self.assertEqual(result['offers'], [])

    def test_pdf_heading_does_not_turn_a_mix_into_beer(self):
        body=document([(20,460,'Offenbier'),(220,460,'3dl'),(300,460,'5dl'),(20,440,'Appenzeller Panache'),(220,440,'5.50'),(300,440,'8.00')])
        self.assertEqual(extract_pdf(body,'url','today'), [])

    def test_no_majority_volume_or_unsubstantiated_ai_draft(self):
        known=[{**offer(), 'beerType':'draft'} for _ in range(10)]
        unknown=offer()
        guessed={**offer(), 'beerTypeEstimate':{'type':'draft','method':'ai','reason':'Brand and size'}}
        estimate_types([{'offers':known},{'offers':[unknown,guessed]}])
        self.assertNotIn('beerTypeEstimate',unknown)
        self.assertNotIn('beerTypeEstimate',guessed)

    def test_portion_pairs_must_match_source_and_not_conflict_with_packaging(self):
        for patch in [{'sourceUrl':'different'}, {'beerType':'bottle'}, {'evidence':'Lager Flasche 3dl 5'}, {'beerTypeEstimate':{'type':'can','method':'ai','sourceImage':'https://example.com/can.jpg'}}]:
            a=offer(); b={**offer(), 'volumeMl':300, **patch}
            estimate_types([{'offers':[a,b]}])
            self.assertNotIn('beerTypeEstimate',a,patch)

    def test_refresh_is_idempotent(self):
        bars=[{'offers':[offer(), {**offer(), 'volumeMl':300}]}]
        estimate_types(bars)
        before=copy.deepcopy(bars)
        estimate_types(bars)
        self.assertEqual(bars,before)

    def test_public_and_reviewed_data_exclude_mixes(self):
        root=Path(__file__).resolve().parents[1]
        bars=json.loads((root/'public/data/bars.json').read_text())['bars']
        menus=json.loads((root/'scraper/reviewed_menus.json').read_text()).values()
        for group in [*bars,*menus]:
            self.assertFalse(any(is_beer_mix(o['name']) for o in group['offers']))
