"""Shared rules for publishing a category dataset."""
import json


def keep_unlisted(output, path, pairs):
    """Venues outside this run's candidates keep their published offers.

    Other scans write the same file (the city scan writes menu items, the menu
    scan all four categories), and a venue can drop out of OpenStreetMap's
    tags for a while. Only a candidate decides its own entry: a complete read
    without a price removes it, and the dataset names it under "removed" so
    scraper.publish lets that one removal through (it keeps every other
    priced venue a scan leaves out).
    """
    if not path.exists():
        return {**output, 'removed': []}
    previous = json.loads(path.read_text())['bars']
    candidates = {bar['id'] for _name, group in pairs for bar in group}
    published = {bar['id'] for bar in output['bars']}
    kept = [bar for bar in previous if bar['id'] not in published | candidates and bar.get('offers')]
    removed = sorted(bar['id'] for bar in previous if bar.get('offers') and bar['id'] in candidates and bar['id'] not in published)
    return {**output, 'bars': sorted(output['bars'] + kept, key=lambda bar: bar['name'].casefold()), 'removed': removed}


def first_error(result):
    """The first fetch or reading error of a website, for the scan log ("" when it was read cleanly)."""
    errors = result.get('errors') or []
    return f' ({errors[0].get("error")} at {errors[0].get("url")})' if errors else ''
