import io
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scraper.http_cache import RunHttpCache
from scraper.scan_logging import log_result
from scraper.scrape import Fetcher, scrape_task


class RunCacheTests(unittest.TestCase):
    def test_success_reused_across_scraper_instances_but_not_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'job.sqlite3')
            response = ('https://bar.example/menu', 'text/html', b'<p>Lager 5dl 7.50</p>')
            with patch.dict('os.environ', {'WOBILLIG_HTTP_CACHE': path}), \
                 patch.object(Fetcher, '_get', return_value=response) as download:
                self.assertEqual(Fetcher().get('https://bar.example'), response)
                second = Fetcher()
                self.assertEqual(second.get('https://bar.example'), response)
                self.assertEqual(second.http_cache.hits, 1)
                download.assert_called_once()
            next_job = RunHttpCache(Path(directory) / 'next-job.sqlite3')
            download = Mock(return_value=response)
            next_job.fetch('https://bar.example', download)
            download.assert_called_once()

    def test_failures_are_retried_and_success_then_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RunHttpCache(Path(directory) / 'job.sqlite3')
            response = ('https://bar.example', 'text/html', b'OK')
            download = Mock(side_effect=[ValueError('http_503'), response])
            with self.assertRaisesRegex(ValueError, 'http_503'):
                cache.fetch('https://bar.example', download)
            self.assertEqual(cache.fetch('https://bar.example', download), response)
            self.assertEqual(cache.fetch('https://bar.example', download), response)
            self.assertEqual(download.call_count, 2)

    def test_concurrent_identical_urls_download_once(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = RunHttpCache(Path(directory) / 'job.sqlite3')
            response = ('https://bar.example', 'text/html', b'OK')
            download = Mock(return_value=response)
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: cache.fetch('https://bar.example', download), range(16)))
            self.assertEqual(results, [response] * 16)
            download.assert_called_once()
            self.assertEqual(cache.hits, 15)

    def test_cache_is_opt_in_and_query_strings_remain_distinct(self):
        with patch.dict('os.environ', {'WOBILLIG_HTTP_CACHE': ''}), \
             patch.object(Fetcher, '_get', return_value=('url', 'text/html', b'OK')) as download:
            fetcher = Fetcher()
            fetcher.get('https://bar.example'); fetcher.get('https://bar.example')
            self.assertEqual(download.call_count, 2)
        with tempfile.TemporaryDirectory() as directory:
            cache = RunHttpCache(Path(directory) / 'job.sqlite3')
            download = Mock(return_value=('url', 'text/html', b'OK'))
            for branch in ('a', 'b'):
                cache.fetch('https://bar.example/menu?branch=' + branch, download)
            self.assertEqual(download.call_count, 2)


class CrawlDiagnosticsTests(unittest.TestCase):
    def test_category_errors_and_urls_without_changing_price_record(self):
        bar = {'id': 'test', 'name': 'Cafe', 'website': 'https://bar.example', 'offers': []}
        fetcher = Mock()
        def get(url):
            if 'menu.pdf' in url:
                raise ValueError('http_503')
            return url, 'text/html', b'<p>Espresso 4.50</p><a href="/menu.pdf?token=secret">Menu</a>'
        fetcher.get.side_effect = get
        beer, details = scrape_task(bar, fetcher, {}, 5)
        self.assertEqual(beer['scrapeStatus'], 'partial')
        self.assertEqual(beer['offers'], [])
        self.assertNotIn('documents', beer)
        self.assertEqual(details['errors'], [{'url': 'https://bar.example/menu.pdf', 'reason': 'http_503', 'phase': 'fetch'}])
        coffee, _ = scrape_task(bar, fetcher, {}, 5, 'coffee')
        self.assertEqual(len(coffee['offers']), 1)
        with redirect_stdout(io.StringIO()) as output:
            log_result(1, 2, beer, details, 'beer', 5)
        self.assertIn('0 beer offers; 1 html; 1 errors', output.getvalue())
        self.assertIn('fetch error: http_503', output.getvalue())
        self.assertNotIn('secret', output.getvalue())

    def test_pdf_parse_failure_and_unsupported_image_are_visible(self):
        bar = {'id': 'test', 'name': 'Cafe', 'website': 'https://bar.example/menu.pdf', 'offers': []}
        fetcher = Mock()
        fetcher.get.return_value = (bar['website'], 'application/pdf', b'invalid')
        with patch('scraper.scrape.extract_pdf', side_effect=ValueError('invalid PDF')):
            _, details = scrape_task(bar, fetcher, {}, 5)
        self.assertEqual(details['errors'][0]['phase'], 'parse')
        self.assertEqual(details['errors'][0]['reason'], 'ValueError')
        with redirect_stdout(io.StringIO()) as output:
            log_result(1, 1, {**bar, 'scrapeStatus': 'fetch_failed'}, details, 'beer', 2)
        self.assertNotIn('page limit reached', output.getvalue())
        fetcher.get.return_value = ('https://bar.example/menu.jpg', 'image/jpeg', b'image')
        _, details = scrape_task(bar, fetcher, {}, 5)
        self.assertEqual(details['documents'][0]['kind'], 'unsupported')
