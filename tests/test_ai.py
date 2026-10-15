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
