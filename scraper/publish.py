"""Publish a saved refresh on top of the latest branch without rebasing JSON.

Snapshots contain only public datasets and crawler checks. If the branch changed
an existing venue/check since the scan started, that entire record wins over the
scan's stale copy. Other refreshed records and new venues are retained.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

FILES = (
    'public/data/bars.json', 'public/data/coffee.json', 'public/data/pizza.json', 'public/data/locations.json',
    'scraper/discovery_checks.json', 'scraper/coffee_checks.json',
    'scraper/pizza_checks.json', 'scraper/ai_checks.json',
) + tuple(f'public/data/{city}/{name}.json' for city in ('bern', 'basel', 'lausanne', 'geneva', 'winterthur') for name in ('bars', 'coffee', 'pizza', 'locations')) + tuple(f'scraper/cities/{city}/{name}_checks.json' for city in ('bern', 'basel', 'lausanne', 'geneva', 'winterthur') for name in ('discovery', 'coffee', 'pizza', 'ai')) + tuple(
    f'{root}/{prefix}{category}{suffix}.json'
    for root, suffix in [('public/data', ''), ('scraper', '_checks')]
    for prefix in (('', 'bern/', 'basel/', 'lausanne/', 'geneva/', 'winterthur/') if root == 'public/data' else ('', 'cities/bern/', 'cities/basel/', 'cities/lausanne/', 'cities/geneva/', 'cities/winterthur/'))
    for category in ('doner', 'falafel')
) + ('scraper/cities/basel/outdoor_permits.json',)
MISSING = object()


def git(repo, *args, check=True):
    return subprocess.run(['git', *args], cwd=repo, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else None


def snapshot(repo, destination):
    base = git(repo, 'rev-parse', 'HEAD').stdout.strip()
    files = {}
    for name in FILES:
        old = git(repo, 'show', f'{base}:{name}', check=False)
        files[name] = {'base': json.loads(old.stdout) if old.returncode == 0 else None,
                       'scanned': read_json(repo / name)}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({'baseCommit': base, 'files': files}, ensure_ascii=False) + '\n')


def merge_records(base, scanned, latest):
    """Apply scan changes only to keys untouched on the branch, including deletes."""
    result = dict(latest)
    conflicts = 0
    for key in base.keys() | scanned.keys():
        before, after = base.get(key, MISSING), scanned.get(key, MISSING)
        current = latest.get(key, MISSING)
        if after == before or after == current:
            continue
        if current != before:
            conflicts += 1
            continue
        if after is MISSING:
            result.pop(key, None)
        else:
            result[key] = after
    return result, conflicts


def venues_by_id(rows):
    result = {row['id']: row for row in rows}
    if len(result) != len(rows):
        raise ValueError('Duplicate venue IDs in refresh dataset')
    return result


def merge_file(name, base, scanned, latest):
    if scanned == base or scanned == latest:
        return latest, 0
    if latest == base:
        return scanned, 0
    if scanned is None or latest is None:
        # A concurrent file deletion/replacement takes priority.
        return latest, 1
    base = base or {}
    if name.startswith('public/data/'):
        merged, conflicts = merge_records(
            {k: v for k, v in base.items() if k != 'bars'},
            {k: v for k, v in scanned.items() if k != 'bars'},
            {k: v for k, v in latest.items() if k != 'bars'},
        )
        bars, bar_conflicts = merge_records(venues_by_id(base.get('bars', [])),
                                           venues_by_id(scanned['bars']), venues_by_id(latest['bars']))
        merged['bars'] = sorted(bars.values(), key=lambda b: (b['name'].casefold(), b['id']))
        return merged, conflicts + bar_conflicts
    return merge_records(base, scanned, latest)


def publish(repo, saved, branch, attempts=3):
    git(repo, 'check-ref-format', f'refs/heads/{branch}')
    if set(saved['files']) - set(FILES):
        raise ValueError('Snapshot contains unsupported paths')
    last_error = ''
    for attempt in range(attempts):
        git(repo, 'fetch', 'origin', f'refs/heads/{branch}')
        latest_commit = git(repo, 'rev-parse', 'FETCH_HEAD').stdout.strip()
        with tempfile.TemporaryDirectory(prefix='price-publish-') as directory:
            worktree = Path(directory) / 'checkout'
            git(repo, 'worktree', 'add', '--detach', str(worktree), latest_commit)
            try:
                conflicts = 0
                for name, versions in saved['files'].items():
                    path = worktree / name
                    merged, count = merge_file(name, versions['base'], versions['scanned'], read_json(path))
                    conflicts += count
                    if merged == read_json(path):
                        continue
                    if merged is None:
                        path.unlink(missing_ok=True)
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + '\n')
                    git(worktree, 'add', '--', name)
                print(f'Publish attempt {attempt + 1}: kept branch version for {conflicts} conflicting records.', flush=True)
                if git(worktree, 'diff', '--cached', '--quiet', check=False).returncode == 0:
                    print('No new data to publish.', flush=True)
                    return
                git(worktree, 'commit', '-m', 'data: refresh city food and drink prices')
                pushed = git(worktree, 'push', 'origin', f'HEAD:refs/heads/{branch}', check=False)
                if pushed.returncode == 0:
                    print(pushed.stderr.strip(), flush=True)
                    return
                last_error = pushed.stderr
                # Rebuild from the original snapshot and the newest branch tip.
                # Never force-push or replay a previous merge result.
            finally:
                git(repo, 'worktree', 'remove', '--force', str(worktree))
    raise RuntimeError(f'Could not publish after {attempts} attempts; snapshot remains available.\n{last_error}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--branch', help='Publish an existing snapshot; omit to create it')
    args = parser.parse_args()
    repo = Path(git(Path.cwd(), 'rev-parse', '--show-toplevel').stdout.strip())
    if args.branch:
        publish(repo, json.loads(args.snapshot.read_text()), args.branch)
    else:
        snapshot(repo, args.snapshot)


if __name__ == '__main__':
    main()
