// Fugitive source page. Field order follows 'Source Inputs Fugitive':
// Step 1 area and release height, Step 2 location and deposition settings,
// Step 3 emission scenarios.
import { calculate, loadGrid, runFileName } from './engine.js';
import { fmt, csvCell } from './format.js';
import * as U from './ui.js';

const $ = U.$;
const gridCache = new Map();
let L, epaModel = null, lastResult = null;

function syncDerived() {
  U.syncSharedDerived(L);
}

function validate(scenarios) {
  if (!(Number($('area').value) > 0)) return 'Enter an area of source greater than 0.';
  return U.validateScenarios(scenarios);
}

function render(result) {
  U.renderResultTables(L, result, fmt);
  const sf = result.scalingFactors;
  U.renderNotes([
    `Area scaling factors (area / 100 m²)^b: fenceline ${sf.inner.toFixed(4)}, ` +
    `outer-boundary ${sf.outer.toFixed(4)}, community ${sf.community.toFixed(4)}, anywhere ${sf.all.toFixed(4)}.`,
    ...U.commonNotes(result.caps, [
      'Following the workbook, the area scaling factor is applied only to blocks that carry a cap. ' +
      'Deposition (and all vapor results) are therefore reported unscaled. This mirrors IIOAC 1.0 exactly.',
    ]),
    'Chemical properties do not enter the fugitive calculation. IIOAC greys them out for this ' +
    'source type. Only the chemical name and CAS number identify the run.',
  ]);
}

function toCsv(result) {
  const r = result.run;
  const src = r.source;
  const rows = [
    ...U.runHeaderCsvRows(r, 'IIOAC fugitive source (web port)'),
    [],
    ...U.chemicalCsvRows(result.chemical, 'Collected and exported, but no fugitive formula reads them.'),
    [],
    ['Source parameters'],
    ['Area of source (m2)', src.area],
    ['Release height (m)', src.height],
    ...U.sharedSourceCsvRows(src),
    [],
    ...U.scenarioCsvRows(r.scenarios),
    [],
    ...U.resultsCsvRows(L, result.rows),
  ];
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

async function run() {
  const status = $('status');
  const scenarios = U.readScenarios();
  const problem = validate(scenarios);
  if (problem) {
    status.textContent = problem;
    status.classList.add('error');
    return;
  }
  status.classList.remove('error');
  status.textContent = 'Loading dispersion data…';

  const particleLabel = $('particle').value;
  const file = runFileName({
    particle: U.slugFor(L, particleLabel),
    locale: $('locale').value,
    met: U.metFor(L),
    emissionType: $('emissionType').value,
  });

  try {
    if (!gridCache.has(file)) gridCache.set(file, await loadGrid(`data/pf/${file}`));
    lastResult = calculate(gridCache.get(file), scenarios, {
      area: Number($('area').value),
      particleLabel,
      locale: $('locale').value,
      caps: L.fugitiveCaps,
      receptors: L.receptors,
      lifetime: L.lifetime,
      scaling: L.fugitiveScalingB,
      referenceArea: L.fugitiveScalingReferenceArea,
      rateConstant: L.emissionRateConstant,
    });
    lastResult.chemical = U.readChemical();
    lastResult.run = {
      exported: new Date().toISOString(),
      version: U.pageVersion(),
      build: $('build').textContent,
      epaModel,
      file,
      scenarios,
      source: {
        area: Number($('area').value),
        height: $('height').value,
        ...U.sharedSourceRecord(),
      },
    };
    render(lastResult);
    $('exportCsv').disabled = false;
    status.textContent = `${scenarios.length} scenario${scenarios.length > 1 ? 's' : ''} · ${file}`;
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
}

(async function init() {
  U.showEpaStatus().then(v => { epaModel = v; });
  try {
    L = await U.loadLookups();
  } catch (err) {
    $('status').textContent = `Could not load lookup data: ${err.message}. Serve the site over HTTP (./serve.sh).`;
    $('status').classList.add('error');
    $('run').disabled = true;
    return;
  }
  U.fillSharedSelects(L);
  for (const id of ['region', 'particle', 'locale']) $(id).addEventListener('change', syncDerived);
  syncDerived();
  U.addScenarioRow(L);
  $('addScenario').addEventListener('click', () => U.addScenarioRow(L));
  $('run').addEventListener('click', run);
  $('showAll').addEventListener('change', () => lastResult && render(lastResult));
  U.attachCsvDownload($('exportCsv'), () => lastResult, toCsv, 'fugitive');
})();
