"""Shared rules for publishing a category dataset."""
import json


def keep_unlisted(output, path, pairs):
    """Venues outside this run's candidates keep their published offers.

    Other scans write the same file (the city scan writes menu items, the menu
    scan all four categories), and a venue can drop out of OpenStreetMap's
    tags for a while. Only a candidate decides its own entry: a complete read
    without a price removes it.
    """
    if not path.exists():
        return output
    listed = {bar['id'] for bar in output['bars']} | {bar['id'] for _name, group in pairs for bar in group}
    kept = [bar for bar in json.loads(path.read_text())['bars'] if bar['id'] not in listed and bar.get('offers')]
    return {**output, 'bars': sorted(output['bars'] + kept, key=lambda bar: bar['name'].casefold())}
