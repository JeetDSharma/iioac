"""Generate data/lookups.json directly from iioac_1.0.xlsm.

Every value is read from the workbook, so nothing here is hand-transcribed.
Re-run after touching the workbook: python3 tools/build_lookups.py
"""
import json
import os
import sys
import warnings

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tests'))
import workbook as W

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'lookups.json')

ws = W.wb()['lookups']
fug = W.wb()['Source Inputs Fugitive']

climate = [{'region': r[0], 'surface': r[1], 'upperAir': r[2], 'met': r[3]}
           for r in ws.iter_rows(min_row=2, max_row=15, min_col=13, max_col=16, values_only=True)]

SLUGS = {'Coarse': 'coarse', 'Fine': 'fine', 'No particles (vapor only)': 'vapor'}
particles = []
for r in range(2, 5):
    label = ws.cell(r, 10).value
    dia, dens = ws.cell(r, 11).value, ws.cell(r, 12).value
    particles.append({
        'label': label, 'slug': SLUGS[label],
        'diameter': dia if isinstance(dia, (int, float)) else None,
        'density': dens if isinstance(dens, (int, float)) else None,
    })

durations = [{'label': ws.cell(r, 1).value, 'hours': ws.cell(r, 3).value,
              'col': ws.cell(r, 2).value - 1} for r in range(18, 22)]

receptors = W.receptor_table()
scaling = {k: {band: ab['b'] for band, ab in v.items()}
           for k, v in W.fugitive_scaling_coefficients().items()}

lookups = {
    '_generated_by': 'tools/build_lookups.py — do not edit by hand',
    '_source': 'iioac_1.0.xlsm, sheets: lookups, Source Inputs Fugitive',
    'climateRegions': climate,
    'particleSizes': particles,
    'emissionDurations': durations,
    'population': {ws.cell(2, 7).value: ws.cell(2, 8).value,
                   ws.cell(3, 7).value: ws.cell(3, 8).value},
    'indoorOutdoorRatio': {'mean': ws['B57'].value, 'high': ws['B58'].value},
    'fugitiveScalingB': scaling,
    'fugitiveScalingReferenceArea': W.scaling_reference_area(),
    'fugitiveCaps': W.fugitive_caps(),
    'emissionRateConstant': W.emission_rate_constant(),
    'receptors': [{'name': r['name'].split(' (')[0], 'ages': r['name'].split('(')[1].rstrip(')'),
                   'bw': r['bw'], 'inhAcute': r['inhAcute'], 'inhChronic': r['inhChronic'],
                   'pctIndoor': r['pctIndoor'], 'pctOutdoor': r['pctOutdoor']}
                  for r in receptors[:7]],
    'lifetime': {'name': 'Lifetime', 'ages': receptors[7]['name'].split('(')[1].rstrip(')'),
                 'bw': receptors[7]['bw'], 'inhAcute': receptors[7]['inhAcute'],
                 'inhChronic': receptors[7]['inhChronic'],
                 'pctIndoor': receptors[7]['pctIndoor'], 'pctOutdoor': receptors[7]['pctOutdoor']},
    'fugitiveReleaseHeight': fug['C7'].value,
}

with open(OUT, 'w') as f:
    json.dump(lookups, f, indent=1)
print(f'wrote {OUT}')
print('  regions', len(lookups['climateRegions']), '| receptors', len(lookups['receptors']),
      '| durations', [d['label'] for d in durations])
print('  release height', lookups['fugitiveReleaseHeight'],
      '| rate const', lookups['emissionRateConstant'])
