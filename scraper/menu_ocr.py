"""Bounded local OCR for scanned menus; cache by image content, never by URL."""
import csv
import hashlib
from io import BytesIO, StringIO
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image
from scraper.cities import CACHE_DIR


def searchable_image(image):
    if not shutil.which('tesseract'):
        raise ValueError('ocr_unavailable: install tesseract-ocr')
    image = image.convert('RGB')
    if max(image.size)<1800:
        factor=min(2,1800/max(image.size))
        image=image.resize((round(image.width*factor),round(image.height*factor)),Image.Resampling.LANCZOS)
    image.thumbnail((3500, 3500))
    buffer = BytesIO(); image.save(buffer, format='PNG')
    payload = buffer.getvalue()
    key = hashlib.sha256(b'pizza-ocr-v1\0' + payload).hexdigest()
    cache = CACHE_DIR / 'ocr'; cache.mkdir(parents=True, exist_ok=True)
    pdf, tsv = cache / (key + '.pdf'), cache / (key + '.tsv')
    if not (pdf.exists() and tsv.exists()):
        with tempfile.TemporaryDirectory(prefix='menu-ocr-') as directory:
            root = Path(directory).resolve()
            source = root / 'page.png'; source.write_bytes(payload)
            target = root / 'result'
            subprocess.run(['tesseract', str(source), str(target), '-l', 'eng', '--psm', '3',
                            '--dpi', '200', 'pdf', 'tsv'],
                           env={**os.environ, 'OMP_THREAD_LIMIT': '1'},
                           capture_output=True, check=True, timeout=45)
            # Independent invocations can share a cache key without partial reads.
            for suffix, destination in [('.pdf', pdf), ('.tsv', tsv)]:
                temporary = cache / (key + '.' + root.name + suffix)
                temporary.write_bytes(target.with_suffix(suffix).read_bytes())
                temporary.replace(destination)
    words = [r for r in csv.DictReader(StringIO(tsv.read_text()), delimiter='\t')
             if r.get('text', '').strip() and float(r.get('conf', '-1')) >= 0]
    return pdf.read_bytes(), words


def image_from_bytes(body):
    with Image.open(BytesIO(body)) as image:
        if image.width * image.height > 24_000_000:
            raise ValueError('menu_image_too_large')
        return image.copy()
