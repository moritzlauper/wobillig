import json
import os
from itertools import takewhile
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from scraper.publish import FILES, merge_file

ROOT = Path(__file__).resolve().parents[1]


class CityTests(unittest.TestCase):
    def test_geneva_discovery_includes_swiss_urban_neighbours(self):
        script = '''
import json
from scraper import cities, scrape, enrich, scrape_pizza, scrape_streetfood, locations
print(json.dumps({'municipalities': cities.MUNICIPALITIES,
    'queries': [scrape.QUERY, enrich.QUERY, scrape_pizza.QUERY, scrape_streetfood.QUERY, locations.QUERY]}))
'''
        data = json.loads(subprocess.check_output(
            [sys.executable, '-c', script], cwd=ROOT,
            env={**os.environ, 'WOBILLIG_CITY': 'geneva'}, text=True))
        municipalities = dict(data['municipalities'])
        self.assertEqual(len(municipalities), 16)
        self.assertEqual(municipalities['Carouge'], 'Q69364')
        self.assertEqual(municipalities['Lancy'], 'Q64065')
        for query in data['queries']:
            for name, wikidata in municipalities.items():
                self.assertIn(f'area["name"="{name}"]["admin_level"="8"]["wikidata"="{wikidata}"];', query)
            self.assertIn(')->.city;', query)
            self.assertNotIn('Annemasse', query)
            self.assertNotIn('Satigny', query)

    def test_each_scraper_uses_the_selected_city(self):
        script = '''
import json
from scraper import cities, scrape, scrape_coffee, scrape_pizza, enrich, locations, ai_scan
print(json.dumps({
    'paths': [str(p.relative_to(cities.ROOT)) for p in [scrape.DATA, scrape_coffee.DATA, scrape_pizza.DATA, enrich.STATE, ai_scan.CHECKS]],
    'queries': [scrape.QUERY, enrich.QUERY, scrape_pizza.QUERY, locations.QUERY]
}))
'''
        for city, name in [('zurich', 'Zürich'), ('bern', 'Bern'), ('basel', 'Basel'), ('lausanne', 'Lausanne'), ('geneva', 'Genève')]:
            with self.subTest(city=city):
                output = subprocess.check_output([sys.executable, '-c', script], cwd=ROOT, env={**os.environ, 'WOBILLIG_CITY': city}, text=True)
                data = json.loads(output)
                prefix = 'public/data/' + ('' if city == 'zurich' else city + '/')
                self.assertEqual(data['paths'][:3], [prefix + p + '.json' for p in ['bars', 'coffee', 'pizza']])
                self.assertTrue(all(f'"name"="{name}"' in query for query in data['queries']))
                self.assertTrue(all(path in FILES for path in data['paths']))

    def test_city_refresh_preserves_concurrent_manual_corrections(self):
        base = {'bars': [{'id': 'node/1', 'name': 'Test', 'offers': []}]}
        scan = {'bars': [{'id': 'node/1', 'name': 'Test', 'offers': [{'priceChf': 5}]}]}
        latest = {'bars': [{'id': 'node/1', 'name': 'Test', 'offers': [{'priceChf': 6}]}]}
        for city in ['bern', 'basel', 'lausanne', 'geneva']:
            self.assertEqual(merge_file(f'public/data/{city}/bars.json', base, scan, latest), (latest, 1))

    def test_real_workflow_cadence_across_year_boundary_and_manual_run(self):
        workflow = (ROOT / '.github/workflows/scrape.yml').read_text()
        cadence_step = workflow.split('        id: check\n', 1)[1]
        run_lines = cadence_step.split('        run: |\n', 1)[1].splitlines(keepends=True)
        # The YAML block ends at the next unindented line, regardless of job names.
        code = textwrap.dedent(''.join(takewhile(
            lambda line: not line.strip() or line.startswith('          '), run_lines,
        )))
        for day, event, expected in [
            ('2026-10-12', 'schedule', False), ('2026-10-19', 'schedule', True),
            ('2026-10-26', 'schedule', False), ('2026-11-02', 'schedule', False),
            ('2026-11-09', 'schedule', True), ('2026-11-30', 'schedule', True),
            ('2026-12-21', 'schedule', True), ('2027-01-04', 'schedule', False),
            ('2027-01-11', 'schedule', True), ('2026-10-16', 'workflow_dispatch', True),
        ]:
            class FixedDateTime(datetime):
                @classmethod
                def now(cls, tz=None):
                    return datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
            with self.subTest(day=day), tempfile.NamedTemporaryFile() as output:
                with patch('datetime.datetime', FixedDateTime), patch.dict(os.environ, GITHUB_EVENT_NAME=event, GITHUB_OUTPUT=output.name):
                    exec(code, {})
                self.assertEqual(Path(output.name).read_text().strip(), f'refresh={str(expected).lower()}')
