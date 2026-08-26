#!/usr/bin/env python3
"""Fingerprint EPA's workbook: the model as extracted, plus a hash per sheet.

Two independent layers, and they fail differently on purpose.

The *model* layer is every value the port depends on, recovered by `workbook.py`
from the workbook's own formula text: the emission constant, the INDEX range
maps, the output row wiring, the indoor/outdoor ratio cells, the receptor table,
the dose coefficients, the caps, the scaling exponents. A diff here names the
number that moved.

The *sheets* layer hashes the formula strings on all 28 sheets, including the
paths this repository has not ported yet. It cannot say what changed, only that
something did — which is the point for `SoilCalc`, where there is no extractor
to notice with.

    python3 fingerprint.py            # diff against model_fingerprint.json
    python3 fingerprint.py --write    # regenerate it
    python3 fingerprint.py --print    # dump to stdout

Exit status 1 means the workbook no longer matches what is committed. On a new
EPA release that is expected: rerun with --write and review the diff.
"""
import argparse
import hashlib
import json
import os
import sys
import warnings

warnings.filterwarnings('ignore', module='openpyxl')

import workbook as W

HERE = os.path.dirname(os.path.abspath(__file__))
FINGERPRINT = os.path.join(HERE, 'model_fingerprint.json')

# The workbook version this fingerprint describes. A new EPA release changes
# this alongside everything else, so it is recorded rather than assumed.
EPA_VERSION = '1.0'

# Sheets carrying the formulas the ported paths were read from. The other
# sheets are fingerprinted too, but a drift in these is a direct hit on shipped
# behaviour rather than a heads-up about unported work.
PORTED_SHEETS = [
    'Point Calculations Prelim',
    'Point Output Prelim',
    'Fugitive Calculations Prelim',
    'Fugitive Output Prelim',
    'lookups',
]

# Constants tables: small sheets that are mostly typed-in numbers rather than
# formulas, so a formula hash would sail past an edited value. These get every
# cell hashed. 'lookups' holds the caps, receptor table and scaling exponents;
# 'Chemical' holds the properties the area paths will need.
VALUE_SHEETS = ['lookups', 'Chemical']


def file_identity():
    h = hashlib.sha256()
    size = 0
    with open(W.WORKBOOK, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
            size += len(chunk)
    return {'name': os.path.basename(W.WORKBOOK), 'bytes': size, 'sha256': h.hexdigest()}


def sheet_formulas(ws):
    """Every formula cell on a sheet, as 'coord\\tformula' lines in cell order.

    Only formulas: the AERMOD values pasted into 'Point+Fugitive Lookup' and the
    VBA-populated output sheets are results, and results are what the oracle
    suite already checks. This layer is meant to track the model.
    """
    lines = []
    for row in ws.iter_rows():
        for cell in row:
            v = cell.value
            if isinstance(v, str) and v.startswith('='):
                lines.append(f'{cell.coordinate}\t{v}')
    return lines


def sheet_values(ws):
    """Every non-empty cell on a sheet, formulas included, in cell order."""
    lines = []
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is not None:
                lines.append(f'{cell.coordinate}\t{cell.value!r}')
    return lines


def sheets_layer():
    out = {}
    for ws in W.wb().worksheets:
        lines = sheet_formulas(ws)
        entry = {
            'ported': ws.title in PORTED_SHEETS,
            'formulaCells': len(lines),
            'sha256': hashlib.sha256('\n'.join(lines).encode('utf-8')).hexdigest(),
        }
        if ws.title in VALUE_SHEETS:
            vals = sheet_values(ws)
            entry['valueCells'] = len(vals)
            entry['valuesSha256'] = hashlib.sha256('\n'.join(vals).encode('utf-8')).hexdigest()
        out[ws.title] = entry
    return out


def model_layer():
    """Everything workbook.py recovers, in one serialisable dict.

    Keyed the way the extractors return it; integer row keys become strings on
    the way through JSON, which is why the diff below compares parsed JSON on
    both sides rather than dict against dict.
    """
    calc = W.calc_row_map()
    labels = W.calc_row_labels()
    return {
        'emissionRateConstant': W.emission_rate_constant(),
        'scalingReferenceArea': W.scaling_reference_area(),
        'calcRows': {
            str(r): {
                'columnOffset': calc[r][0],
                'band': calc[r][1],
                'location': labels[r][0],
                'statistic': labels[r][1],
            }
            for r in sorted(calc)
        },
        'outputRows': {str(r): v for r, v in W.output_row_map().items()},
        'ioRatios': W.io_ratios(),
        'receptors': W.receptor_table(),
        'doseCoefficients': {
            k: {'multipliers': m, 'divisors': d}
            for k, (m, d) in W.dose_formula_coefficients().items()
        },
        'fugitiveCaps': W.fugitive_caps(),
        'fugitiveScaling': W.fugitive_scaling_coefficients(),
    }


def build():
    return {
        'epaVersion': EPA_VERSION,
        'workbook': file_identity(),
        'model': model_layer(),
        'sheets': sheets_layer(),
    }


def dumps(fp):
    return json.dumps(fp, indent=2, sort_keys=True) + '\n'


def diff(old, new, path=''):
    """Flat list of 'where: old -> new' lines. Leaves compare by value."""
    out = []
    if isinstance(old, dict) and isinstance(new, dict):
        for k in sorted(set(old) | set(new)):
            where = f'{path}.{k}' if path else k
            if k not in new:
                out.append(f'{where}: removed')
            elif k not in old:
                out.append(f'{where}: added -> {json.dumps(new[k])}')
            else:
                out += diff(old[k], new[k], where)
    elif isinstance(old, list) and isinstance(new, list):
        for i in range(max(len(old), len(new))):
            where = f'{path}[{i}]'
            if i >= len(new):
                out.append(f'{where}: removed')
            elif i >= len(old):
                out.append(f'{where}: added -> {json.dumps(new[i])}')
            else:
                out += diff(old[i], new[i], where)
    elif old != new:
        out.append(f'{path}: {json.dumps(old)} -> {json.dumps(new)}')
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--write', action='store_true', help='regenerate model_fingerprint.json')
    g.add_argument('--print', dest='print_', action='store_true', help='dump to stdout')
    args = ap.parse_args()

    fp = build()

    if args.print_:
        sys.stdout.write(dumps(fp))
        return 0

    if args.write:
        existed = os.path.exists(FINGERPRINT)
        before = json.load(open(FINGERPRINT)) if existed else None
        with open(FINGERPRINT, 'w') as fh:
            fh.write(dumps(fp))
        rel = os.path.relpath(FINGERPRINT, os.getcwd())
        if before is None:
            print(f'wrote {rel} ({len(fp["sheets"])} sheets)')
        else:
            changes = diff(before, json.loads(dumps(fp)))
            print(f'wrote {rel} ({len(changes)} change{"" if len(changes) == 1 else "s"})')
            for line in changes:
                print(f'  {line}')
        return 0

    if not os.path.exists(FINGERPRINT):
        print('no model_fingerprint.json — run: python3 fingerprint.py --write')
        return 1

    before = json.load(open(FINGERPRINT))
    changes = diff(before, json.loads(dumps(fp)))
    if not changes:
        print(f'fingerprint matches ({len(fp["sheets"])} sheets, EPA IIOAC {fp["epaVersion"]})')
        return 0

    ported = {n for n, s in fp['sheets'].items() if s['ported']}
    print(f'workbook differs from the committed fingerprint ({len(changes)} changes):')
    for line in changes:
        hot = line.startswith('model.') or any(line.startswith(f'sheets.{n}.') for n in ported)
        print(f'  {"!" if hot else " "} {line}')
    print('\n! marks the ported model. Review, then: python3 fingerprint.py --write')
    return 1


if __name__ == '__main__':
    sys.exit(main())
