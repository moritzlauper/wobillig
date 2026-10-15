import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scraper.ai import Claude, BudgetExhausted, APIUnavailable, clean_offers
from scraper.ai_scan import merge_offers
from scraper.estimates import estimate_types


def offer(**kw):
    return dict(name='Lager', volumeMl=500, priceChf=8, sourceUrl='https://example.com/menu', observedAt='2026-10-15', confidence='automatic', evidence='Lager 5dl 8', alcoholFree=False, beerType='unknown', **kw)


class EstimateTests(unittest.TestCase):
    def test_estimate_keeps_source_type_and_prices(self):
        a=offer(); b=offer(); b['volumeMl']=300
        bars=[{'offers':[a,b]}]; before=copy.deepcopy(bars)
        estimate_types(bars)
        self.assertEqual(a['beerTypeEstimate']['type'],'draft')
        for index,o in enumerate(bars[0]['offers']):
            self.assertEqual({k:v for k,v in o.items() if k!='beerTypeEstimate'},before[0]['offers'][index])

    def test_explicit_formats_win_and_ambiguous_half_litre_is_unknown(self):
        a=offer(); a['beerType']='bottle'; a['beerTypeEstimate']={'type':'draft','method':'ai'}
        b=offer(); b['name']='Other'
        estimate_types([{'offers':[a,b]}])
        self.assertNotIn('beerTypeEstimate',a)
        self.assertNotIn('beerTypeEstimate',b)

    def test_ai_estimate_survives_rule_refresh(self):
        a=offer(); a['beerTypeEstimate']={'type':'can','reason':'test','method':'ai'}
        estimate_types([{'offers':[a]}]); self.assertEqual(a['beerTypeEstimate']['type'],'can')


class AITests(unittest.TestCase):
    def row(self,**kw):
        x=dict(name='Lager',drink='beer',volumeMl=500,priceChf=8,coffeeType='',beerType='unknown',estimatedBeerType='draft',estimateReason='Mehrere Glasgrössen',stange=False,alcoholFree=False,evidence='Lager 5dl 8.00',page=1);x.update(kw);return x

    def clean(self,**kw): return clean_offers({'offers':[self.row(**kw)]},'https://example.com/menu','today')

    def test_estimated_type_is_separate_and_source_is_fixed(self):
        o=self.clean()[0]; self.assertEqual(o['beerType'],'unknown');self.assertEqual(o['beerTypeEstimate']['type'],'draft');self.assertEqual(o['confidence'],'ai')
        self.assertEqual(o['sourceUrl'],'https://example.com/menu')

    def test_invalid_prices_sizes_pages_and_missing_price_evidence_are_rejected(self):
        for kw in [{'priceChf':float('nan')},{'priceChf':80},{'priceChf':True},{'volumeMl':50},{'volumeMl':None},{'page':7},{'evidence':'Lager 5dl ohne Preis'}]:
            self.assertEqual(self.clean(**kw),[],kw)
        self.assertEqual(len(self.clean(volumeMl=None,stange=True,evidence='Stange Lager 8.00')),1)

    def test_html_cannot_invent_product(self):
        self.assertEqual(clean_offers({'offers':[self.row()]},'url','today',source_text='Espresso 8.00'),[])

    def test_merge_keeps_prices_and_separate_formats(self):
        original=offer(); original['confidence']='reviewed'
        changed=offer(); changed['priceChf']=3
        self.assertEqual(merge_offers([original],[changed]),[original])
        bottle=offer();bottle['beerType']='bottle'
        draft=offer();draft['beerType']='draft'
        self.assertEqual(len(merge_offers([bottle],[draft])),2)

    def test_inference_does_not_change_community_keys(self):
        original=offer(); found=self.clean()[0]
        merged=merge_offers([original],[found])[0]
        self.assertEqual(merged['beerType'],'unknown');self.assertEqual(merged['beerTypeEstimate']['type'],'draft')

    @patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-only'})
    def test_budget_cache_and_incomplete_response(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=Claude(.001,10,Path(tmp))
            with patch.object(c,'post',return_value={'input_tokens':100}):
                with self.assertRaises(BudgetExhausted):c.ask([{'type':'text','text':'menu'}])
            self.assertEqual(c.requests,0)
            c=Claude(1,10,Path(tmp))
            replies=[{'input_tokens':100},{'stop_reason':'end_turn','content':[{'type':'text','text':'{"offers":[]}'}],'usage':{'input_tokens':100,'output_tokens':10}}]
            with patch.object(c,'post',side_effect=replies) as post:
                self.assertEqual(c.ask([{'type':'text','text':'menu'}]),{'offers':[]})
                self.assertEqual(c.ask([{'type':'text','text':'menu'}]),{'offers':[]})
                self.assertEqual(post.call_count,2)
            self.assertEqual(c.hits,1)
            with patch.object(c,'post',side_effect=[{'input_tokens':100},{'stop_reason':'max_tokens','usage':{}}]):
                with self.assertRaises(APIUnavailable):c.ask([{'type':'text','text':'different'}])

class APIErrorTests(unittest.TestCase):
    @patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-secret'})
    def test_haiku_only_and_hard_budget_even_with_oversized_input(self):
        from scraper.ai import MODEL, MAX_BUDGET_USD
        self.assertEqual(MODEL, 'claude-haiku-5-5')
        with tempfile.TemporaryDirectory() as tmp:
            c=Claude(100,1000,Path(tmp))
            self.assertEqual(c.budget, 1.00)
            for bad in [float('nan'), float('inf'), -1]:
                with self.assertRaises(ValueError): Claude(bad,cache=Path(tmp))
            replies=[{'input_tokens':1000},{'stop_reason':'end_turn','content':[{'type':'text','text':'{"offers":[]}'}],'usage':{'input_tokens':1000,'output_tokens':100}}]
            with patch.object(c,'post',side_effect=replies) as post:
                c.ask([{'type':'text','text':'menu'}])
                self.assertTrue(all(call.args[1]['model']==MODEL for call in post.call_args_list))
            self.assertAlmostEqual(c.spent,.00015)
            c.spent=MAX_BUDGET_USD-.001
            with patch.object(c,'post',return_value={'input_tokens':100}) as post:
                with self.assertRaises(BudgetExhausted): c.ask([{'type':'text','text':'other'}])
                self.assertEqual([call.args[0] for call in post.call_args_list],['messages/count_tokens'])

    @patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-secret'})
    def test_failed_generation_is_not_retried_or_refunded(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as tmp:
            c=Claude(cache=Path(tmp))
            response=Mock(status_code=503)
            with patch('scraper.ai.requests.post',return_value=response) as post:
                with self.assertRaises(APIUnavailable):c.post('messages',{})
                self.assertEqual(post.call_count,1)
            with patch.object(c,'post',side_effect=[{'input_tokens':1000},APIUnavailable('failed')]):
                with self.assertRaises(APIUnavailable):c.ask([{'type':'text','text':'menu'}])
            self.assertGreater(c.spent,0)
            self.assertLessEqual(c.spent,.50)

    @patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-secret'})
    def test_long_prompt_rejected_before_paid_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=Claude(cache=Path(tmp))
            with patch.object(c,'post',return_value={'input_tokens':100001}) as post:
                with self.assertRaises(APIUnavailable):c.ask([{'type':'text','text':'menu'}])
                self.assertEqual(post.call_count,1)
            self.assertEqual(c.requests,0)

    @patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-secret'})
    def test_bad_document_does_not_disable_other_scans_or_reveal_key(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as tmp:
            c=Claude(cache=Path(tmp))
            response=Mock(status_code=400)
            response.json.return_value={'error':{'message':'PDF could not be processed test-secret'}}
            with patch('scraper.ai.requests.post',return_value=response):
                with self.assertRaises(APIUnavailable) as caught:c.post('messages',{})
            self.assertFalse(c.disabled)
            self.assertNotIn('test-secret',str(caught.exception))
            response.json.return_value={'error':{'message':'Your credit balance is too low'}}
            with patch('scraper.ai.requests.post',return_value=response):
                with self.assertRaises(APIUnavailable):c.post('messages',{})
            self.assertTrue(c.disabled)

    def test_glass_size_variants_override_an_inconsistent_ai_guess(self):
        a=offer(); b=offer();b['volumeMl']=300
        for o in [a,b]:o['beerTypeEstimate']={'type':'bottle','reason':'guess','method':'ai'}
        estimate_types([{'offers':[a,b]}])
        self.assertEqual(a['beerTypeEstimate']['type'],'draft')
        self.assertEqual(b['beerTypeEstimate']['type'],'draft')

class DocumentSelectionTests(unittest.TestCase):
    def test_food_pages_are_skipped_but_scanned_and_drink_pages_are_kept(self):
        from scraper.ai import drink_page
        food = 'Vorspeisen Salat Pasta Pizza Risotto Spaghetti mit Tomatensauce und Parmesan. ' * 5
        self.assertFalse(drink_page(food))
        self.assertTrue(drink_page(''))
        self.assertTrue(drink_page(food + ' Espresso 4.50'))
        self.assertTrue(drink_page(food + ' Special Haze 33cl 8.50'))
        self.assertTrue(drink_page(food + ' Stange 5.50'))

class ScanReuseTests(unittest.TestCase):
    def test_identical_menu_under_two_urls_only_uses_model_once(self):
        import time
        from unittest.mock import Mock
        from scraper.ai_scan import scan_venue
        body=b'<h2>Bier</h2><p>Lager 5dl 8.00</p>'
        fetcher=Mock();fetcher.get.side_effect=lambda url:(url,'text/html',body)
        client=Mock();client.ask.return_value={'offers':[]}
        bar={'id':'test','name':'Test Bar','address':'Zurich','website':None,'offers':[]}
        found,status,errors=scan_venue(bar,client,fetcher,{'test':['https://example.com/menu-a','https://example.com/menu-b']},8,time.monotonic()+30)
        self.assertEqual(client.ask.call_count,1)
        self.assertEqual(status,'checked')
        self.assertEqual(errors,[])

class PriceAssociationTests(unittest.TestCase):
    def test_sparse_table_does_not_guess_size_columns(self):
        from scraper.ai import supported_size_price
        evidence='25cl 30cl 40cl 50cl | Ittinger Klosterbräu 5.5 7.6'
        self.assertFalse(supported_size_price(evidence,300,7.6))
        self.assertTrue(supported_size_price('Lager 30cl CHF 5.50 / 50cl CHF 8.50',500,8.5))
        self.assertFalse(supported_size_price('Lager 30cl CHF 5.50 / 50cl CHF 8.50',500,5.5))
        self.assertFalse(supported_size_price('Lager 33cl 8.50',500,8.5))

    def test_capacity_and_abv_in_names_do_not_create_duplicate_prices(self):
        a=offer();a['name']='Lager (USA)'
        b=offer();b['name']='Lager (USA) 5% 50cl'
        self.assertEqual(len(merge_offers([a],[b])),1)

    def test_exclusive_reviewed_source_is_not_overwritten_by_ai(self):
        import time,hashlib
        from unittest.mock import Mock
        from scraper.ai_scan import scan_venue
        body=b'<h2>Bier</h2><p>Lager 5dl 8.00</p>';url='https://example.com/menu'
        fetcher=Mock();fetcher.get.return_value=(url,'text/html',body)
        client=Mock();client.ask.return_value={'offers':[AITests().row()]}
        bar={'id':'test','name':'Test Bar','address':'Zurich','website':url,'offers':[]}
        review={url:{'barId':'test','exclusive':True,'sha256':hashlib.sha256(body).hexdigest()}}
        with patch('scraper.ai_scan.REVIEWED_MENUS',review):
            found,_,_=scan_venue(bar,client,fetcher,{},8,time.monotonic()+30)
        self.assertEqual(found,[])
        self.assertIn('ONLY extract these drink categories: coffee',client.ask.call_args.kwargs['system'])

class CafeCoverageTests(unittest.TestCase):
    def test_cafe_without_website_or_price_remains_available_for_contributions(self):
        from scraper.scrape_coffee import include_cafes
        cafe={'id':'node/364410129','name':'Plüsch','type':'cafe','website':None,'offers':[]}
        restaurant={**cafe,'id':'node/other','type':'restaurant'}
        output={}
        include_cafes(output,[cafe,restaurant])
        self.assertIn(cafe['id'],output)
        self.assertNotIn(restaurant['id'],output)
        self.assertEqual(output[cafe['id']]['offers'],[])
        output[cafe['id']]['offers']=[{'priceChf':4.5}]
        include_cafes(output,[cafe])
        self.assertEqual(output[cafe['id']]['offers'],[{'priceChf':4.5}])

    def test_missing_cafe_gets_budget_before_already_priced_bar(self):
        from scraper.ai_scan import candidate_priority
        cafe={'id':'c','name':'Z','type':'cafe','offers':[]}
        bar={'id':'b','name':'A','type':'bar','offers':[{'priceChf':8}]}
        self.assertLess(candidate_priority(cafe,{},{}),candidate_priority(bar,{},{}))

    def test_missing_bars_are_not_starved_by_repeated_empty_cafe_scans(self):
        from scraper.ai_scan import candidate_priority
        cafe={'id':'c','name':'A','type':'cafe','offers':[]}
        bar={'id':'b','name':'Z','type':'bar','offers':[]}
        checks={'c':{'checkedAt':'2026-10-15'},'b':{'checkedAt':'2026-10-14'}}
        self.assertLess(candidate_priority(bar,checks,{}),candidate_priority(cafe,checks,{}))
        checks['b']['checkedAt']='2026-10-16'
        self.assertLess(candidate_priority(cafe,checks,{}),candidate_priority(bar,checks,{}))

class CostAndSourceRegressionTests(unittest.TestCase):
    @patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-secret'})
    def test_parallel_generations_share_one_budget(self):
        import time
        from concurrent.futures import ThreadPoolExecutor
        with tempfile.TemporaryDirectory() as tmp:
            c=Claude(.05,1000,Path(tmp))
            def post(path,payload):
                if path.endswith('count_tokens'): return {'input_tokens':1000}
                time.sleep(.005)
                return {'stop_reason':'end_turn','content':[{'type':'text','text':'{"offers":[]}'}],'usage':{'input_tokens':1000,'output_tokens':6000}}
            def ask(i):
                try:c.ask([{'type':'text','text':str(i)}]);return True
                except BudgetExhausted:return False
            with patch.object(c,'post',side_effect=post):
                with ThreadPoolExecutor(max_workers=6) as pool: success=sum(pool.map(ask,range(100)))
            self.assertGreater(success,0)
            self.assertLess(success,100)
            self.assertLessEqual(c.spent,.05)
            self.assertAlmostEqual(c.spent,success*.0031)

    def test_press_pdf_is_not_treated_as_a_menu(self):
        from scraper.scrape import html_content
        body=b'<a href="/Neue_Zuercher_Zeitung_20201008.pdf">Bericht</a><a href="/Getraenke.pdf">Karte</a>'
        _,links=html_content(body,'https://example.com/')
        self.assertEqual(links,['https://example.com/Getraenke.pdf'])
