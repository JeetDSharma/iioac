#!/usr/bin/env python3
"""Build tests/fixtures/ from EPA's IIOAC distribution, verifying every byte.

    python3 tests/fetch_fixtures.py            # the 18 run files the suites need
    python3 tests/fetch_fixtures.py --full     # also keep the full 672-file zip

EPA's files are not redistributed here, so this downloads them (331 MB) and checks
each one against tests/fixtures.sha256. A mismatch means the file is not what this
port was validated against, and is a hard error rather than a warning.

The download is cached, so a second run is free. Set IIOAC_DIST to a copy you have
already downloaded and nothing is fetched at all.
"""
import hashlib
import os
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, 'fixtures')
MANIFEST = os.path.join(HERE, 'fixtures.sha256')

URL = 'https://www.epa.gov/sites/default/files/2019-06/iioac_1.0.zip'
DIST = os.environ.get('IIOAC_DIST') or os.path.join(FIXTURES, 'iioac_1.0.zip')


def manifest():
    """{name: sha256} from fixtures.sha256, comments and blanks ignored."""
    out = {}
    with open(MANIFEST) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            digest, name = line.split(None, 1)
            out[name.strip()] = digest
    return out


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def check(name, data, want):
    got = sha256(data)
    if got != want[name]:
        sys.exit(f'CHECKSUM MISMATCH  {name}\n  expected {want[name]}\n  got      {got}\n'
                 'This is not the file IIOAC-web was validated against. If EPA has '
                 'published a new version, see ROADMAP.md.')
    print(f'  ok  {name}')


def download(dest):
    print(f'downloading {URL}')
    tmp = dest + '.part'
    with urllib.request.urlopen(URL) as r, open(tmp, 'wb') as f:
        total = int(r.headers.get('Content-Length') or 0)
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if total:
                print(f'\r  {done >> 20}/{total >> 20} MB', end='', flush=True)
    print()
    os.replace(tmp, dest)


def main():
    full = '--full' in sys.argv
    want = manifest()
    needed = sorted(n[len('runfiles/'):] for n in want if n.startswith('runfiles/'))
    os.makedirs(FIXTURES, exist_ok=True)

    if not os.path.exists(DIST):
        download(DIST)
    else:
        print(f'using cached {DIST}')

    with zipfile.ZipFile(DIST) as dist:
        names = dist.namelist()
        xlsm = next((n for n in names if n.lower().endswith('.xlsm')), None)
        inner = next((n for n in names if re.search(r'runfiles.*\.zip$', n, re.I)), None)
        if not xlsm or not inner:
            sys.exit(f'unexpected archive layout in {DIST}: {names[:10]}')

        print('workbook:')
        data = dist.read(xlsm)
        check('iioac_1.0.xlsm', data, want)
        with open(os.path.join(FIXTURES, 'iioac_1.0.xlsm'), 'wb') as f:
            f.write(data)

        # Spill the nested zip to disk rather than holding 331 MB in memory.
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp:
            with dist.open(inner) as src:
                shutil.copyfileobj(src, tmp)
            inner_path = tmp.name

    try:
        print(f'run files ({len(needed)} of 672):')
        with zipfile.ZipFile(inner_path) as rf, \
                zipfile.ZipFile(os.path.join(FIXTURES, 'runfiles.zip'), 'w',
                                zipfile.ZIP_DEFLATED) as out:
            for name in needed:
                data = rf.read(name)
                check('runfiles/' + name, data, want)
                out.writestr(name, data)
        if full:
            dest = os.path.join(FIXTURES, 'IIOAC_RunFiles.zip')
            shutil.copyfile(inner_path, dest)
            print(f'kept the full run files at {dest}')
            print(f'  run the 672-file sweep with:  IIOAC_RUNFILES={dest} ./run_all.sh')
    finally:
        os.unlink(inner_path)

    print('\nfixtures ready. cd tests && ./run_all.sh')


if __name__ == '__main__':
    main()
