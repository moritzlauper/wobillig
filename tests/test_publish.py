import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scraper import publish as publisher

DATA = 'public/data/bars.json'
CHECKS = 'scraper/ai_checks.json'


def venue(id, price=5):
    return {'id': id, 'name': id, 'offers': [{'name': 'Lager', 'priceChf': price}]}


def dataset(*bars):
    return {'generatedAt': '2026-10-15', 'bars': list(bars)}


class MergeTests(unittest.TestCase):
    def test_preserves_concurrent_correction_addition_and_deletion(self):
        base = dataset(venue('corrected'), venue('removed'), venue('refreshed'), venue('unchanged'))
        scanned = dataset(venue('corrected', 6), venue('removed', 6), venue('refreshed', 6),
                          venue('unchanged'), venue('new scan'))
        latest = dataset(venue('corrected', 7), venue('refreshed'), venue('unchanged'), venue('new branch'))
        result, conflicts = publisher.merge_file(DATA, base, scanned, latest)
        self.assertEqual(conflicts, 2)
        bars = {b['id']: b for b in result['bars']}
        self.assertEqual(bars['corrected'], venue('corrected', 7))
        self.assertEqual(bars['refreshed'], venue('refreshed', 6))
        self.assertNotIn('removed', bars)
        self.assertIn('new scan', bars)
        self.assertIn('new branch', bars)
        self.assertEqual(base['bars'][0], venue('corrected'))

    def test_scan_removals_do_not_remove_branch_corrections(self):
        base = dataset(venue('removed'), venue('corrected'))
        latest = dataset(venue('removed'), venue('corrected', 7))
        result, conflicts = publisher.merge_file(DATA, base, dataset(), latest)
        self.assertEqual(result['bars'], [venue('corrected', 7)])
        self.assertEqual(conflicts, 1)

    def test_unchanged_scan_preserves_latest_file_including_deletion(self):
        base = dataset(venue('a'))
        self.assertEqual(publisher.merge_file(DATA, base, base, None), (None, 0))
        self.assertEqual(publisher.merge_file(DATA, base, dataset(venue('b')), None), (None, 1))

    def test_new_files_and_disjoint_checks(self):
        scanned = {'a': {'status': 'checked'}, 'b': {'status': 'partial'}}
        latest = {'b': {'status': 'reviewed'}, 'c': {'status': 'checked'}}
        result, conflicts = publisher.merge_file(CHECKS, None, scanned, latest)
        self.assertEqual(result, {**scanned, **latest})
        self.assertEqual(conflicts, 1)
        self.assertEqual(publisher.merge_file(DATA, None, dataset(venue('a')), None), (dataset(venue('a')), 0))

    def test_concurrent_new_venues_and_duplicate_ids(self):
        result, conflicts = publisher.merge_file(DATA, None, dataset(venue('a')), dataset(venue('b')))
        self.assertEqual(len(result['bars']), 2)
        with self.assertRaisesRegex(ValueError, 'Duplicate venue IDs'):
            publisher.venues_by_id([venue('a'), venue('a')])


class PublishIntegrationTests(unittest.TestCase):
    def test_push_race_preserves_code_corrections_and_scan_without_touching_checkout(self):
        # All repositories and pushes in this test are temporary and local.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            origin, scan, writer = (root / name for name in ('origin.git', 'scan', 'writer'))
            def git(repo, *args):
                return publisher.git(repo, *args).stdout.strip()
            git(root, 'init', '--bare', str(origin))
            git(root, 'clone', str(origin), str(scan))
            git(scan, 'checkout', '-b', 'main')
            git(scan, 'config', 'user.name', 'Test')
            git(scan, 'config', 'user.email', 'test@example.invalid')
            def write(repo, name, value):
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value))
            def commit(repo, message):
                git(repo, 'add', '.')
                git(repo, 'commit', '-m', message)
            write(scan, DATA, dataset(venue('a'), venue('b')))
            commit(scan, 'base')
            git(scan, 'push', 'origin', 'main')
            git(root, 'clone', '--branch', 'main', str(origin), str(writer))
            git(writer, 'config', 'user.name', 'Test')
            git(writer, 'config', 'user.email', 'test@example.invalid')
            write(scan, DATA, dataset(venue('a', 6), venue('b', 6), venue('new')))
            write(scan, CHECKS, {'new': {'status': 'checked'}})
            snapshot_path = root / 'snapshot.json'
            publisher.snapshot(scan, snapshot_path)
            saved = json.loads(snapshot_path.read_text())
            scan_head = git(scan, 'rev-parse', 'HEAD')
            scan_content = (scan / DATA).read_bytes()
            write(writer, DATA, dataset(venue('a', 7), venue('b')))
            (writer / 'application.txt').write_text('new code')
            commit(writer, 'concurrent correction')
            git(writer, 'push', 'origin', 'main')
            original_git = publisher.git
            pushes = []
            def racing_git(repo, *args, **kwargs):
                if args[0] == 'push':
                    pushes.append(args)
                    if len(pushes) == 1:
                        # Advance origin after the publisher fetched, before push.
                        write(writer, DATA, dataset(venue('a', 7), venue('b'), venue('raced')))
                        original_git(writer, 'add', '.')
                        original_git(writer, 'commit', '-m', 'push during publish')
                        original_git(writer, 'push', 'origin', 'main')
                return original_git(repo, *args, **kwargs)
            with patch.object(publisher, 'git', side_effect=racing_git):
                publisher.publish(scan, saved, 'main')
            self.assertEqual(len(pushes), 2)
            git(writer, 'pull', '--ff-only')
            published = json.loads((writer / DATA).read_text())
            self.assertEqual(published['bars'], [venue('a', 7), venue('b', 6), venue('new'), venue('raced')])
            self.assertEqual(json.loads((writer / CHECKS).read_text()), {'new': {'status': 'checked'}})
            self.assertEqual((writer / 'application.txt').read_text(), 'new code')
            self.assertEqual(git(scan, 'rev-parse', 'HEAD'), scan_head)
            self.assertEqual((scan / DATA).read_bytes(), scan_content)
            self.assertEqual(json.loads(snapshot_path.read_text()), saved)
            self.assertEqual(git(scan, 'worktree', 'list', '--porcelain').count('worktree '), 1)
            tip = git(writer, 'rev-parse', 'HEAD')
            publisher.publish(scan, saved, 'main')
            git(writer, 'fetch', 'origin', 'main')
            self.assertEqual(git(writer, 'rev-parse', 'FETCH_HEAD'), tip)

    def test_unknown_snapshot_paths_are_rejected(self):
        with patch.object(publisher, 'git'):
            with self.assertRaisesRegex(ValueError, 'unsupported paths'):
                publisher.publish(Path('.'), {'files': {'../private': {}}}, 'main')


if __name__ == '__main__':
    unittest.main()
