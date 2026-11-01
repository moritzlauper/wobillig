"""Branches of one chain that share a website.

OpenStreetMap lists every branch with the chain's website, so a scan that
groups venues by website sees several venues on one host. Chains price
their menu the same in every branch, so one read covers all of them.
Unrelated venues that only share a host (a page builder, a directory, a
mall) stay out: every branch name must carry the brand of the host.
"""
import re
import unicodedata
from urllib.parse import urlparse


def chain_label(website):
    """The brand part of a host: www.holycow.ch -> holycow, john-baker.ch -> johnbaker."""
    parts = (urlparse(website or '').hostname or '').removeprefix('www.').split('.')
    return re.sub(r'[\W_]', '', parts[-2] if len(parts) > 1 else parts[0]).casefold()


def is_chain(group):
    label = chain_label(group[0]['website'])
    names = [re.sub(r'[\W_]', '', unicodedata.normalize('NFKD', bar['name']).encode('ascii', 'ignore').decode()).casefold() for bar in group]
    return len(label) >= 4 and all(label in name or name in label for name in names)
