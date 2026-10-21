"""Refresh Lausanne's official statistical boundaries from the municipal export.

Run: .venv/bin/python -m scraper.districts_lausanne
Dependencies: pip install -r scraper/requirements.txt
"""
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

import requests
import shapefile
from pyproj import Transformer
from scraper.scrape import UA, now

SOURCE = 'https://viageo.ch/md/29cfd252-6b51-4798-92af-6f9aaf229dcc'
DOWNLOAD = 'https://viageo.ch/donnee/telecharger/300517'


def main():
    response = requests.get(DOWNLOAD, headers={'User-Agent': UA}, timeout=60)
    response.raise_for_status()
    with ZipFile(BytesIO(response.content)) as archive:
        parts = {Path(name).suffix: archive.read(name) for name in archive.namelist()}
    reader = shapefile.Reader(shp=BytesIO(parts['.shp']), shx=BytesIO(parts['.shx']), dbf=BytesIO(parts['.dbf']))
    transform = Transformer.from_crs(parts['.prj'].decode(), 'EPSG:4326', always_xy=True)

    def coordinates(value):
        if isinstance(value[0], (float, int)):
            return [round(n, 6) for n in transform.transform(*value[:2])]
        return [coordinates(part) for part in value]

    def points(value):
        if isinstance(value[0], (float, int)):
            yield value
        else:
            for part in value:
                yield from points(part)

    features = []
    for record in reader.shapeRecords():
        geometry = record.shape.__geo_interface__
        geometry['coordinates'] = coordinates(geometry['coordinates'])
        xy = list(points(geometry['coordinates']))
        features.append({'type': 'Feature', 'properties': {
            'number': record.record.NUMQUARTIE, 'name': record.record.NOMQUARTIE,
        }, 'geometry': geometry, 'bbox': [min(p[0] for p in xy), min(p[1] for p in xy), max(p[0] for p in xy), max(p[1] for p in xy)]})
    features.sort(key=lambda f: f['properties']['number'])
    if [f['properties']['number'] for f in features] != [*range(1, 18), 90]:
        raise ValueError('Unexpected Lausanne district numbers; previous file kept')
    data = {'type': 'FeatureCollection', 'features': features, 'source': SOURCE,
            'license': 'Ville de Lausanne: non-commercial use with attribution; commercial use requires permission',
            'retrievedAt': now()[:10]}
    path = Path(__file__).resolve().parents[1] / 'public/data/lausanne/districts.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'lausanne: {len(features)} districts')


if __name__ == '__main__':
    main()
