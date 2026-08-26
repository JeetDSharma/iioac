"""Compare engine.js output against the workbook-derived oracle."""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
import workbook as W

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 1e-6          # float32 storage error dominates; anything larger is a real defect

results = []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(f'{"PASS" if ok else "FAIL"}  {name}' + (f'  — {detail}' if detail else ''))


def rel(a, b):
    if a == b:
        return 0.0
    return abs(a - b) / max(abs(a), abs(b), 1e-300)


subprocess.run(['node', 'engine_runner.mjs'], cwd=HERE, check=True,
               stdout=subprocess.DEVNULL)
engine = json.load(open(os.path.join(HERE, 'engine_out.json')))
cases = json.load(open(os.path.join(HERE, 'cases.json')))

SCALARS = ['outdoorDaily', 'outdoorAnnual', 'indoorDaily', 'indoorAnnual',
           'totalDep', 'wetDep', 'dryDep', 'lifetime']

worst_overall = 0.0
for case, eng in zip(cases, engine):
    grid = oracle.load_xlsx_grid(eng['file'].replace('.bin', '.xlsx'))
    ref, ref_sf, _ = oracle.calculate(grid, case['scenarios'], case['area'],
                                      case['particleLabel'], case['locale'],
                                      source=case.get('source', 'fugitive'))

    # Scaling factors
    sf_worst = max(rel(ref_sf[k], eng['scalingFactors'][k]) for k in ref_sf)
    check(f"[{case['name']}] scaling factors", sf_worst < 1e-12, f'worst {sf_worst:.2e}')

    # Only the six rows the workbook actually surfaces are oracle-comparable.
    compared = 0
    worst = 0.0
    worst_where = ''
    for row in eng['rows']:
        key = (row['stat'], row['location'])
        if key not in ref:
            continue          # Low-End / Anywhere rows have no workbook output row
        compared += 1
        exp = ref[key]
        for f in SCALARS:
            r = rel(exp[f], row[f])
            if r > worst:
                worst, worst_where = r, f
        for i in range(7):
            for f in ('acute', 'chronic'):
                r = rel(exp[f][i], row[f][i])
                if r > worst:
                    worst, worst_where = r, f'{f}[{i}]'
    worst_overall = max(worst_overall, worst)
    check(f"[{case['name']}] {compared} output rows x 23 values",
          compared == 6 and worst < TOL, f'worst {worst:.2e} on {worst_where}')

check('every engine value within 1e-6 of the workbook oracle', worst_overall < TOL,
      f'worst relative error {worst_overall:.3e}')

# Structural agreement between the engine's constants and the workbook.
L = json.load(open(os.path.join(HERE, '..', 'data', 'lookups.json')))
eng_src = open(os.path.join(HERE, '..', 'engine.js')).read()

check('engine uses the workbook emission constant 0.2778',
      f'* {W.emission_rate_constant()}' in eng_src or '0.2778' in eng_src)

ratios = W.io_ratios()
check('indoor/outdoor ratios match lookups!B57/B58',
      L['indoorOutdoorRatio']['mean'] == ratios['B57']
      and L['indoorOutdoorRatio']['high'] == ratios['B58'],
      f"{L['indoorOutdoorRatio']} vs {ratios}")

caps = W.fugitive_caps()
check('fugitive caps match lookups row 63/64 (Fugitive columns C/E/G)',
      all(L['fugitiveCaps'][k]['dailyAir'] == v['dailyAir']
          and L['fugitiveCaps'][k]['annualAir'] == v['annualAir']
          for k, v in caps.items()), str(caps))

pcaps = W.point_caps()
check('point caps match lookups row 63/64 (Point columns B/D/F)',
      all(L['pointCaps'][k]['dailyAir'] == v['dailyAir']
          and L['pointCaps'][k]['annualAir'] == v['annualAir']
          for k, v in pcaps.items()), str(pcaps))

# Point sources must have no scaling block anywhere in lookups. If EPA ever adds
# one, the point pages silently stop matching, so assert its absence.
labels = [c.value for c in W.wb()['lookups']['A'] if isinstance(c.value, str)]
check('lookups defines scaling coefficients for Area and Fugitive only',
      sorted(x for x in labels if 'Scaling Factor Coefficients' in x)
      == ['*Scaling Factor Coefficients - Area Source',
          '*Scaling Factor Coefficients - Fugitive Source'],
      str([x for x in labels if 'Scaling Factor Coefficients' in x]))

wb_types = W.point_source_types()
type_bad = [(a, b) for a, b in zip(wb_types, L['pointSourceTypes'])
            if a['label'] != b['label']
            or a['releaseHeight'] != b['releaseHeight']
            or a['stackDiameter'] != b['stackDiameter']
            or a['exitGasTemp'] != b['exitGasTemp']
            or a['exitGasVelocity'] != b['exitGasVelocity']]
check('all 3 point source types match lookups!B2:F4',
      not type_bad and len(wb_types) == 3, str(type_bad[:2]))

wb_scaling = W.fugitive_scaling_coefficients()
sc_bad = [(k, band) for k, v in wb_scaling.items() for band, ab in v.items()
          if abs(L['fugitiveScalingB'][k][band] - ab['b']) > 0]
check('scaling exponents match lookups!A43:E54 exactly', not sc_bad, str(sc_bad[:3]))

wb_rec = W.receptor_table()
rec_bad = []
for i, r in enumerate(wb_rec[:7]):
    j = L['receptors'][i]
    for field in ('bw', 'inhAcute', 'inhChronic', 'pctIndoor', 'pctOutdoor'):
        if rel(r[field], j[field]) > 1e-12:
            rec_bad.append((r['name'], field, r[field], j[field]))
for field in ('bw', 'inhAcute', 'inhChronic', 'pctIndoor', 'pctOutdoor'):
    if wb_rec[7][field] != L['lifetime'][field]:
        rec_bad.append(('Lifetime', field, wb_rec[7][field], L['lifetime'][field]))
check('all 8 receptor rows match lookups!A25:F32', not rec_bad, str(rec_bad[:3]))

names_bad = [(a['name'], b['region']) for a, b in
             zip(W.wb()['lookups'].iter_rows(min_row=2, max_row=15, min_col=13, max_col=16,
                                             values_only=True), [])]
wb_regions = [(r[0], r[1], r[2], r[3]) for r in
              W.wb()['lookups'].iter_rows(min_row=2, max_row=15, min_col=13, max_col=16,
                                          values_only=True)]
region_bad = [(w, j) for w, j in zip(wb_regions, L['climateRegions'])
              if w[0] != j['region'] or w[1] != j['surface']
              or w[2] != j['upperAir'] or w[3] != j['met']]
check('all 14 climate regions and met numbers match lookups!M2:P15',
      not region_bad and len(wb_regions) == 14, str(region_bad[:2]))

print()
failed = [r for r in results if not r[1]]
print(f'test_engine.py: {len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
