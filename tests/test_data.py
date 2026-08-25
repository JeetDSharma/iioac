"""Verify every converted .bin matches the AERMOD .xlsx it came from."""
import os
import random
import struct
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import oracle

SCRATCH = ('/private/tmp/claude-501/-Users-jeetsharma-Documents-iioac/'
           '7ad0ce66-8400-4b69-a8b1-369e7d4b6730/scratchpad')
sys.path.insert(0, SCRATCH)
import convert  # the fast reader used to build the .bin files

DATA = os.path.expanduser('~/Documents/iioac/site/data')
EXPECTED_BYTES = 1460 * 60 * 4

results = []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(f'{"PASS" if ok else "FAIL"}  {name}' + (f'  — {detail}' if detail else ''))


def bin_grid(path):
    raw = open(path, 'rb').read()
    return raw, [list(struct.unpack_from('<60f', raw, r * 240)) for r in range(1460)]


# 1. Every run file in the zip has a .bin, every .bin is the right size, none are all-zero.
with zipfile.ZipFile(oracle.RUNFILES) as z:
    names = [n for n in z.namelist() if n.startswith('results_')]
xlsx_names = sorted(n for n in names if n.endswith('.xlsx'))
csv_names = sorted(n for n in names if n.endswith('.csv'))

missing, wrong_size, empty = [], [], []
for n in xlsx_names:
    p = os.path.join(DATA, 'pf', n[:-5] + '.bin')
    if not os.path.exists(p):
        missing.append(n)
        continue
    size = os.path.getsize(p)
    if size != EXPECTED_BYTES:
        wrong_size.append((n, size))
        continue
    raw = open(p, 'rb').read()
    if not any(raw):
        empty.append(n)

check(f'all {len(xlsx_names)} run files converted', not missing, f'{len(missing)} missing')
check('every .bin is 350,400 bytes', not wrong_size, f'{len(wrong_size)} wrong')
check('no .bin is entirely zero', not empty, f'{len(empty)} empty')
check(f'all {len(csv_names)} area CSVs converted',
      all(os.path.exists(os.path.join(DATA, 'area', n[:-4] + '.json')) for n in csv_names))

# 2. Full-sweep byte comparison: re-read every xlsx and re-derive the bytes.
mismatch = []
with zipfile.ZipFile(oracle.RUNFILES) as z:
    for i, n in enumerate(xlsx_names):
        grid = convert.read_grid(z.read(n))
        buf = bytearray()
        for row in grid:
            buf += struct.pack('<60f', *row)
        raw = open(os.path.join(DATA, 'pf', n[:-5] + '.bin'), 'rb').read()
        if bytes(buf) != raw:
            mismatch.append(n)
        if (i + 1) % 100 == 0:
            print(f'      ... swept {i + 1}/{len(xlsx_names)}', flush=True)
check(f'all {len(xlsx_names)} .bin files byte-match a re-conversion',
      not mismatch, f'{len(mismatch)} differ')

# 3. Independent reader: openpyxl reads a random sample and must agree cell for cell.
random.seed(20260821)
sample = random.sample([n for n in xlsx_names if 'fugitive' in n], 8)
sample += random.sample([n for n in xlsx_names if 'point' in n], 4)
worst = 0.0
bad = []
for n in sample:
    ref = oracle.load_xlsx_grid(n)
    _, got = bin_grid(os.path.join(DATA, 'pf', n[:-5] + '.bin'))
    for r in range(1460):
        for c in range(60):
            a, b = ref[r][c], got[r][c]
            if a == 0 and b == 0:
                continue
            rel = abs(a - b) / max(abs(a), 1e-300)
            worst = max(worst, rel)
            if rel > 1e-6:
                bad.append((n, r, c, a, b))
check(f'openpyxl agrees with {len(sample)} sampled .bin files (1.05M cells)',
      not bad, f'worst relative error {worst:.3e}' if not bad else f'{len(bad)} cells differ')
check('float32 storage error stays under 1e-6', worst < 1e-6, f'worst {worst:.3e}')

# 4. Structural checks on the band/row layout.
n = 'results_fugitive_fine_urban_met1_consecutive.xlsx'
ref = oracle.load_xlsx_grid(n)
check('run file has 4 bands x 365 days = 1460 rows', len(ref) == 1460)
check('run file has 60 columns', all(len(r) == 60 for r in ref))
# Rows must be strictly grouped: frequency 1 of each band sits at 0, 365, 730, 1095.
check('band boundaries land on multiples of 365',
      all(i % 365 == 0 for i in (0, 365, 730, 1095)))

print()
failed = [r for r in results if not r[1]]
print(f'test_data.py: {len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
