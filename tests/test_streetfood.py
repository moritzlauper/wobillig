import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from scraper.streetfood import food_row, food_html, food_pdf, food_image, food_orderstar
from scraper.scrape_streetfood import crawl, menu_links, skip_source
from scraper.publish import FILES, merge_file
from scraper.scan_report import coverage, snapshot
from test_pdf import document

URL = 'https://example.org/menu'
STAMP = '2026-10-19'
ROOT = Path(__file__).resolve().parents[1]


class StreetfoodTests(unittest.TestCase):
    def test_only_standard_doner_and_falafel_wraps_are_accepted(self):
        cases = [('Dürüm 13.–', 'doner', 'wrap', 13),
                 ('Poulet Kebab Wrap 12.00', 'doner', 'wrap', 12),
                 ('Döner Yufka 12.50', 'doner', 'wrap', 12.5),
                 ('Falafel Dürüm 12.00', 'falafel', 'wrap', 12),
                 ('42. Falafel Wrap 10.00', 'falafel', 'wrap', 10)]
        for text, category, portion, price in cases:
            with self.subTest(text=text):
                offers = food_row(text, URL, STAMP, category)
                self.assertEqual(len(offers), 1)
                self.assertEqual((offers[0]['foodType'], offers[0]['portionType'], offers[0]['priceChf']), (category, portion, price))
                self.assertEqual((offers[0]['sourceUrl'], offers[0]['observedAt']), (URL, STAMP))

    def test_no_boxes_plates_menus_mixed_fillings_or_ambiguous_prices(self):
        rejected = ['Döner im Taschenbrot 12.50', 'Kebab 11', 'Poulet Kebab im Brot 12',
                    'Falafel Sandwich 11', 'Falafel im Fladenbrot 10', 'Dürüm oder Taschenbrot 12', 'Döner Box 12', 'Döner Teller 18', 'Döner Menü 15', 'Dürüm mit Pommes 14',
                    'Döner 10.00 / 13.00', 'Döner XXL 15', 'Döner mini 7', 'Döner + Getränk 14',
                    'Döner 200g 12', 'Döner 12 Pizza 15', 'Döner 3', 'Döner 40',
                    'Dürüm Sucuk 12', 'Dürüm Gemüse 10', 'Vegi Kebab 10', 'Döner Poulet oder Kalb 13',
                    'Falafel 10', 'Falafel 6 Stück 8', 'Falafel Teller 18', 'Falafel Dürüm Menü 15',
                    'Falafel und Döner Sandwich 12', 'Falafel Wrap 10 12', 'Dürüm Halloumi 13']
        for text in rejected:
            for category in ('doner', 'falafel'):
                with self.subTest(text=text, category=category):
                    self.assertEqual(food_row(text, URL, STAMP, category), [])

    def test_html_cards_excluded_sections_and_online_labels(self):
        body = '<h2>Sandwiches</h2><article><h3>Döner Dürüm</h3><span>12.50</span></article><h2>Kinder Menüs</h2><p>Döner Dürüm 7.00</p><h2>Sandwiches</h2><p>Falafel Wrap 11.00</p>'.encode()
        self.assertEqual([o['priceChf'] for o in food_html(body, URL, STAMP, 'doner')], [12.5])
        self.assertEqual([o['priceChf'] for o in food_html(body, URL, STAMP, 'falafel')], [11])
        online = food_html(b'<title>Online bestellen</title><p>Kebab Wrap 12.50</p>', URL, STAMP, 'doner')
        self.assertEqual(online[0]['priceContext'], 'online_menu')
        self.assertEqual(food_html(b'<h3>Kebab</h3><p>Pizza 12.50</p>', URL, STAMP, 'doner'), [])

    def test_pdf_row_alignment_and_section_exclusions(self):
        body = document([(20, 460, 'Sandwiches'), (20, 440, 'Kebab Wrap'), (350, 440, '12.50'),
                         (20, 420, 'Falafel Wrap'), (350, 420, '11.00'),
                         (20, 400, 'Kinder Menus'), (20, 380, 'Kebab Wrap 7.00')])
        self.assertEqual([o['priceChf'] for o in food_pdf(body, URL, STAMP, 'doner', ocr=False)], [12.5])
        self.assertEqual([o['priceChf'] for o in food_pdf(body, URL, STAMP, 'falafel', ocr=False)], [11])

    def test_ocr_requires_confident_nearby_name_and_price(self):
        from io import BytesIO
        from PIL import Image
        image = BytesIO(); Image.new('RGB', (400, 100), 'white').save(image, format='PNG')
        body = document([(20, 440, 'Kebab Wrap 12.50')])
        words = [{'text': 'Kebab', 'conf': '96', 'top': '20', 'height': '20'},
                 {'text': '12.50', 'conf': '96', 'top': '20', 'height': '20'}]
        with patch('scraper.menu_ocr.searchable_image', return_value=(body, words)):
            self.assertEqual(food_image(image.getvalue(), URL, STAMP, 'doner')[0]['extractionMethod'], 'ocr')
            words[1]['conf'] = '30'
            self.assertEqual(food_image(image.getvalue(), URL, STAMP, 'doner'), [])

    def test_orderstar_only_accepts_standard_portions(self):
        body = json.dumps({'isSuccessful': True, 'categories': [{'name': 'Sandwiches', 'products': [
            {'name': 'Kebab Wrap', 'sizes': [{'name': 'Normal', 'price': 12}, {'name': 'XXL', 'price': 16}]},
            {'name': 'Falafel Wrap', 'price': 11}, {'name': 'Kebab Box', 'price': 9},
        ]}]})
        self.assertEqual([o['priceChf'] for o in food_orderstar(body, URL, STAMP, 'doner')], [12])
        self.assertEqual(food_orderstar(body, URL, STAMP, 'falafel')[0]['priceContext'], 'online_menu')

    @unittest.skipUnless(shutil.which('tesseract'), 'Tesseract is not installed')
    def test_real_image_ocr_reads_both_standard_wraps(self):
        from io import BytesIO
        from PIL import Image, ImageDraw, ImageFont
        fonts = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf']
        font_path = next((p for p in fonts if Path(p).exists()), None)
        if not font_path:
            self.skipTest('No fixture font available')
        image = Image.new('RGB', (1400, 500), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(font_path, 48)
        draw.text((70, 70), 'Kebab Wrap       12.50', font=font, fill='black')
        draw.text((70, 200), 'Falafel Wrap    11.00', font=font, fill='black')
        body = BytesIO(); image.save(body, format='PNG')
        with tempfile.TemporaryDirectory() as directory, patch('scraper.menu_ocr.CACHE_DIR', Path(directory)):
            self.assertEqual([o['priceChf'] for o in food_image(body.getvalue(), URL, STAMP, 'doner')], [12.5])
            self.assertEqual([o['priceChf'] for o in food_image(body.getvalue(), URL, STAMP, 'falafel')], [11])


class StreetfoodCrawlTests(unittest.TestCase):
    def setUp(self):
        self.bar = {'id': 'node/1', 'name': 'Kebab Shop', 'website': URL, 'type': 'fast_food', 'offers': []}
    def fetcher(self, bodies):
        fetcher = Mock()
        def get(url):
            if url not in bodies:
                raise ValueError('offline')
            body = bodies[url]
            return url, 'text/html', body.encode()
        fetcher.get.side_effect = get
        return fetcher

    def test_takeaway_menu_images_allowed_but_cart_actions_not_followed(self):
        body = b'<a href="/takeaway.pdf">Menu</a><img data-src="/menu.jpg"><a href="/?add-to-cart=12">Kebab</a><a href="/checkout">Order</a>'
        self.assertEqual(menu_links(body, URL), ['https://example.org/takeaway.pdf', 'https://example.org/menu.jpg'])
        self.assertFalse(skip_source('https://example.org/takeaway.pdf'))
        self.assertTrue(skip_source('https://example.org/?add-to-cart=12'))

    def test_non_imbiss_venues_are_never_fetched_even_with_matching_names(self):
        for category in ('doner', 'falafel'):
            for venue_type in ('restaurant', 'cafe', 'bar', 'pub', None):
                fetcher = self.fetcher({URL: '<p>Dürüm 12</p><p>Falafel Wrap 11</p>'})
                bar, check = crawl({**self.bar, 'type': venue_type, 'name': 'Döner Falafel Restaurant'}, fetcher, {}, 120, category)
                fetcher.get.assert_not_called()
                self.assertEqual(bar['offers'], [])
                self.assertEqual(check['status'], 'excluded_venue')

    def test_failed_fetch_does_not_retain_old_bread_or_unspecified_prices(self):
        for category in ('doner', 'falafel'):
            offers = [{'foodType': category, 'portionType': portion, 'priceChf': 12, 'sourceUrl': URL}
                      for portion in ('bread', 'unspecified')]
            bar, _ = crawl({**self.bar, 'offers': offers}, self.fetcher({}), {}, 120, category)
            self.assertEqual(bar['offers'], [])

    def test_conflicts_are_withheld_per_portion_and_meat_type(self):
        fetcher = self.fetcher({URL: '<p>Kebab Wrap 11</p><p>Kebab Wrap 12</p><p>Poulet Dürüm 13</p>'})
        bar, check = crawl(self.bar, fetcher, {}, 120, 'doner')
        self.assertEqual([(o['portionType'], o['priceChf']) for o in bar['offers']], [('wrap', 13)])
        self.assertEqual(check['status'], 'ambiguous_prices')

    def test_branch_hints_cannot_borrow_another_locations_prices(self):
        branch = URL + '/bern'
        fetcher = self.fetcher({URL: '<p>Kebab Wrap 9</p>', branch: '<p>Kebab Wrap 12</p><a href="/menu/zurich">Menu</a>'})
        bar, check = crawl(self.bar, fetcher, {'node/1': [branch]}, 120, 'doner')
        self.assertEqual([o['priceChf'] for o in bar['offers']], [12])
        self.assertNotIn('https://example.org/menu/zurich', check['visited'])

    def test_failed_fetch_preserves_observation_but_changed_source_removes_it(self):
        old = food_row('Kebab Wrap 12', URL, '2026-09-01', 'doner')[0]
        bar = {**self.bar, 'offers': [old]}
        failed, _ = crawl(bar, self.fetcher({}), {}, 120, 'doner')
        self.assertEqual(failed['offers'], [old])
        updated, _ = crawl(bar, self.fetcher({URL: '<p>Keine Sandwiches mehr</p>'}), {}, 120, 'doner')
        self.assertEqual(updated['offers'], [])

    def test_imbiss_menu_prices_win_over_online_prices(self):
        shop = 'https://example.org/order'
        fetcher = self.fetcher({URL: '<p>Kebab Wrap 12</p><a href="/order">Order</a>', shop: '<p>Kebab Wrap 14</p>'})
        bar, _ = crawl(self.bar, fetcher, {}, 120, 'doner')
        self.assertEqual([o['priceChf'] for o in bar['offers']], [12])

    def test_page_limit_is_respected(self):
        fetcher = self.fetcher({URL: '<a href="/menu2">Menu</a>', 'https://example.org/menu2': '<p>Kebab Wrap 12</p>'})
        bar, check = crawl(self.bar, fetcher, {}, 1, 'doner')
        self.assertEqual(check['visited'], [URL])


class StreetfoodPipelineTests(unittest.TestCase):
    def test_old_non_imbiss_venues_and_non_wrap_prices_are_removed_without_crawling(self):
        from scraper.scrape_streetfood import main
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for category in ('doner', 'falafel'):
                data, checks = root / f'{category}.json', root / f'{category}_checks.json'
                offers = [{'foodType': category, 'portionType': portion, 'priceChf': 12}
                          for portion in ('bread', 'unspecified', 'wrap')]
                data.write_text(json.dumps({'bars': [
                    {'id': 'node/1', 'name': 'Döner Falafel Restaurant', 'type': 'restaurant', 'offers': offers},
                    {'id': 'node/2', 'name': 'Döner Falafel Imbiss', 'type': 'fast_food', 'offers': offers},
                ]}))
                with patch('sys.argv', ['scrape', '--category', category]), patch('scraper.scrape_streetfood.paths', return_value=(data, checks)), patch('scraper.scrape_streetfood.crawl') as crawl_mock:
                    main()
                crawl_mock.assert_not_called()
                bars = json.loads(data.read_text())['bars']
                self.assertEqual([b['id'] for b in bars], ['node/2'])
                self.assertEqual(bars[0]['offers'], [offers[2]])

    def test_archive_cli_writes_new_dataset_and_checks_with_original_observation(self):
        from scraper.scrape_streetfood import main
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archive = root / 'archive'; archive.mkdir()
            (archive / 'menu.json').write_text(json.dumps({'url': URL, 'kind': 'text/html', 'observedAt': '2026-09-25'}))
            (archive / 'menu.body').write_text('<p>Kebab Wrap 12.50</p><p>Falafel Wrap 11.00</p>')
            venue = {'id': 'node/1', 'name': 'Kebab Shop', 'type': 'fast_food', 'website': URL, 'offers': []}
            restaurant = {**venue, 'id': 'node/2', 'name': 'Döner Falafel Restaurant', 'type': 'restaurant'}
            venues = root / 'venues.json'; venues.write_text(json.dumps({'bars': [venue, restaurant]}))
            for category in ('doner', 'falafel'):
                data, checks = root / f'{category}.json', root / f'{category}_checks.json'
                args = ['scrape', '--category', category, '--venues-file', str(venues), '--archive-dir', str(archive), '--max-pages', '120']
                with patch('sys.argv', args), patch('scraper.scrape_streetfood.paths', return_value=(data, checks)):
                    main()
                offer = json.loads(data.read_text())['bars'][0]['offers'][0]
                self.assertEqual([b['id'] for b in json.loads(data.read_text())['bars']], ['node/1'])
                self.assertNotIn('node/2', json.loads(checks.read_text()))
                self.assertEqual(offer['foodType'], category)
                self.assertEqual(offer['observedAt'], '2026-09-25')
                self.assertEqual(json.loads(checks.read_text())['node/1']['status'], 'prices_found')

    def test_both_categories_have_independent_paths_and_publish_support_in_all_cities(self):
        script = 'import json; from scraper.scrape_streetfood import paths, QUERY; print(json.dumps({"paths": [str(p) for c in ("doner", "falafel") for p in paths(c)], "query": QUERY}))'
        for city, name in [('zurich', 'Zürich'), ('bern', 'Bern'), ('basel', 'Basel')]:
            result = json.loads(subprocess.check_output([sys.executable, '-c', script], cwd=ROOT, env={**os.environ, 'WOBILLIG_CITY': city}, text=True))
            self.assertIn(f'"name"="{name}"', result['query'])
            self.assertIn('fast_food', result['query'])
            self.assertNotIn('restaurant', result['query'])
            self.assertNotIn('cafe', result['query'])
            for path in result['paths']:
                relative = str(Path(path).relative_to(ROOT))
                self.assertIn(relative, FILES)
                self.assertEqual('/bern/' in relative, city == 'bern')
                self.assertEqual('/basel/' in relative, city == 'basel')

    def test_first_scan_baseline_has_empty_new_categories_and_only_wrap_products(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('bars', 'coffee', 'pizza'):
                (root / f'{name}.json').write_text('{"bars": []}')
            self.assertEqual(snapshot(root)['categories']['doner']['pricedVenues'], 0)
        offers = food_row('Kebab im Brot 12', URL, STAMP, 'doner') + food_row('Dürüm 13', URL, STAMP, 'doner')
        self.assertEqual(coverage([{'id': '1', 'offers': offers}])['products'], 1)

    def test_github_actions_exclude_streetfood(self):
        workflow = (ROOT / '.github/workflows/scrape.yml').read_text()
        city = (ROOT / '.github/workflows/scrape-city.yml').read_text()
        stage = (ROOT / '.github/workflows/scrape-stage.yml').read_text()
        self.assertNotIn('streetfood_only', workflow)
        self.assertIn('needs: [drinks, pizza]', city)
        for category in ('doner', 'falafel'):
            self.assertNotIn(f'stage: {category}', city)
            self.assertNotIn(f'--category {category}', stage)
        self.assertNotIn('scraper.scrape_streetfood', stage)
        self.assertNotIn('STREETFOOD_PAGES', stage)

    def test_new_food_files_merge_without_overwriting_concurrent_changes(self):
        base = {'bars': [{'id': '1', 'name': 'Test', 'offers': []}]}
        scanned = {'bars': [{'id': '1', 'name': 'Test', 'offers': [{'priceChf': 11}]}]}
        latest = {'bars': [{'id': '1', 'name': 'Test', 'offers': [{'priceChf': 12}]}]}
        for category in ('doner', 'falafel'):
            self.assertEqual(merge_file(f'public/data/basel/{category}.json', base, scanned, latest), (latest, 1))
