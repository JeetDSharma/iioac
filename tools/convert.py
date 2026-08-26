"""Convert the EPA IIOAC AERMOD run files into compact binaries the web app can fetch.

Point/fugitive: one .bin per run file, 1460 rows x 60 cols of float32, row-major.
Rows are 4 receptor bands (inner, outer, all, community) x 365 days/year.
Area soil/water: one .json per met station, 1826 daily unit values x 3 rings.
"""
import csv, io, json, os, re, struct, sys, zipfile
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))

# EPA's full IIOAC_RunFiles.zip. Not bundled: it is 329 MB, over GitHub's 100 MB
# per-file limit. See tests/README.md for where to download it.
ZIP = os.environ.get('IIOAC_RUNFILES') or os.path.join(HERE, '..', 'tests', 'fixtures', 'runfiles.zip')
OUT = os.environ.get('IIOAC_DATA_OUT') or os.path.join(HERE, '..', 'data')

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def read_grid(xlsx_bytes):
    """Parse the single sheet of an AERMOD results workbook into a 1460x60 float list.

    Every cell in these files is stored as a shared string, so numbers have to be
    resolved through the shared string table rather than read from <v> directly.
    """
    import xml.etree.ElementTree as ET
    z = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    name = next(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
    shared = []
    for _, el in ET.iterparse(io.BytesIO(z.read('xl/sharedStrings.xml')), events=('end',)):
        if el.tag == NS + 'si':
            text = ''.join(t.text or '' for t in el.iter(NS + 't'))
            try:
                shared.append(float(text))
            except ValueError:
                shared.append(0.0)
            el.clear()
    grid = [[0.0] * 60 for _ in range(1460)]
    for _, el in ET.iterparse(io.BytesIO(z.read(name)), events=('end',)):
        if el.tag != NS + 'row':
            continue
        r = int(el.get('r'))
        if r >= 2:
            out = grid[r - 2]
            for c in el:
                ref = c.get('r')
                col = 0
                for ch in ref:
                    if ch.isalpha():
                        col = col * 26 + (ord(ch) - 64)
                    else:
                        break
                v = c.find(NS + 'v')
                if v is not None and v.text and col <= 60:
                    raw = v.text
                    out[col - 1] = shared[int(raw)] if c.get('t') == 's' else float(raw)
        el.clear()
    return grid


def do_pf(name):
    dest = os.path.join(OUT, 'pf', name[:-5] + '.bin')
    if os.path.exists(dest) and os.path.getsize(dest) == 1460 * 60 * 4:
        return name, 'skip'
    with zipfile.ZipFile(ZIP) as z:
        grid = read_grid(z.read(name))
    buf = bytearray()
    for row in grid:
        buf += struct.pack('<60f', *row)
    tmp = dest + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(buf)
    os.replace(tmp, dest)
    return name, 'ok'


def do_area(name):
    with zipfile.ZipFile(ZIP) as z:
        text = z.read(name).decode()
    rows = list(csv.reader(io.StringIO(text)))[1:]
    cols = [[], [], []]
    for row in rows:
        if len(row) < 4 or not row[0].strip():
            continue
        for i in range(3):
            cell = row[i + 1].strip()
            cols[i].append(round(float(cell), 6) if cell else 0.0)
    dest = os.path.join(OUT, 'area', name[:-4] + '.json')
    with open(dest, 'w') as f:
        json.dump({'inner': cols[0], 'outer': cols[1], 'community': cols[2]}, f)
    return name, 'ok'


if __name__ == '__main__':
    with zipfile.ZipFile(ZIP) as z:
        names = [n for n in z.namelist() if n.startswith('results_')]
    pf = sorted(n for n in names if n.endswith('.xlsx'))
    area = sorted(n for n in names if n.endswith('.csv'))
    for n in area:
        print(*do_area(n), flush=True)
    done = 0
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        for name, status in ex.map(do_pf, pf, chunksize=2):
            done += 1
            if done % 20 == 0 or done == len(pf):
                print(f'{done}/{len(pf)} {name} {status}', flush=True)
    print('DONE', flush=True)
