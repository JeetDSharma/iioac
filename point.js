// Point source page. Field order follows 'Source Inputs Point':
// Step 1 select the point source type, which fixes all four stack parameters;
// Step 2 location and deposition settings; Step 3 emission scenarios.
//
// The calculation itself is the fugitive calculation. Comparing every formula in
// 'Point Calculations Prelim', 'Point Calculations', 'Point Output Prelim' and
// 'Point Output' against their fugitive counterparts finds no difference beyond
// the sheet name. The two paths diverge only in their inputs:
//
//   * the source type adds a dimension to the run file (504 files, not 168)
//   * lookups has no "Scaling Factor Coefficients - Point Source" block and the
//     point sheet has no area input, so every point scaling factor is 1
//   * caps come from the Point columns of the lookups!B60 block (B/D/F), which
//     hold the same numbers as the Fugitive columns in IIOAC 1.0 but are
//     separate cells
import { calculate, loadGrid, pointRunFileName } from './engine.js';
import { fmt, csvCell } from './format.js';
import * as U from './ui.js';

const $ = U.$;
const gridCache = new Map();
let L, epaModel = null, lastResult = null;

function sourceType() {
  return L.pointSourceTypes.find(t => t.label === $('sourceType').value);
}

function syncDerived() {
  const t = sourceType();
  $('height').value = t.releaseHeight;
  $('stackDiameter').value = t.stackDiameter;
  $('exitGasTemp').value = t.exitGasTemp;
  $('exitGasVelocity').value = t.exitGasVelocity;
  U.syncSharedDerived(L);
}

function render(result) {
  U.renderResultTables(L, result, fmt);
  U.renderNotes([
    ...U.commonNotes(result.caps, [
      'Point sources are not area-scaled. IIOAC defines scaling factor coefficients for the ' +
      'Fugitive and Area source paths only, and the point input sheet has no area to scale by, ' +
      'so every factor here is 1.',
    ]),
    `Release height, stack inside diameter, exit gas temperature and exit gas velocity are fixed ` +
    `by the source type, exactly as the workbook's dropdown sets them. "${$('sourceType').value}" ` +
    `gives ${sourceType().releaseHeight} m, ${sourceType().stackDiameter} m, ` +
    `${sourceType().exitGasTemp} K and ${sourceType().exitGasVelocity} m/s.`,
    'Those four values pick the pre-computed AERMOD run, so they change the results through the ' +
    'dispersion data rather than through any formula on this page.',
    'Chemical properties do not enter the point calculation. IIOAC greys them out for this ' +
    'source type. Only the chemical name and CAS number identify the run.',
  ]);
}

function toCsv(result) {
  const r = result.run;
  const src = r.source;
  const rows = [
    ...U.runHeaderCsvRows(r, 'IIOAC point source (web port)'),
    [],
    ...U.chemicalCsvRows(result.chemical, 'Collected and exported, but no point formula reads them.'),
    [],
    ['Source parameters'],
    ['Point source type', src.sourceType],
    ['Release height (m)', src.height],
    ['Stack inside diameter (m)', src.stackDiameter],
    ['Exit gas temperature (K)', src.exitGasTemp],
    ['Exit gas velocity (m/s)', src.exitGasVelocity],
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
  const problem = U.validateScenarios(scenarios);
  if (problem) {
    status.textContent = problem;
    status.classList.add('error');
    return;
  }
  status.classList.remove('error');
  status.textContent = 'Loading dispersion data…';

  const particleLabel = $('particle').value;
  const t = sourceType();
  const file = pointRunFileName({
    sourceType: t.slug,
    particle: U.slugFor(L, particleLabel),
    locale: $('locale').value,
    met: U.metFor(L),
    emissionType: $('emissionType').value,
  });

  try {
    if (!gridCache.has(file)) gridCache.set(file, await loadGrid(`data/pf/${file}`));
    lastResult = calculate(gridCache.get(file), scenarios, {
      area: null,
      particleLabel,
      locale: $('locale').value,
      caps: L.pointCaps,
      receptors: L.receptors,
      lifetime: L.lifetime,
      scaling: null,          // no point scaling block in lookups; factors are 1
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
        sourceType: t.label,
        height: $('height').value,
        stackDiameter: $('stackDiameter').value,
        exitGasTemp: $('exitGasTemp').value,
        exitGasVelocity: $('exitGasVelocity').value,
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
  $('sourceType').innerHTML = L.pointSourceTypes.map(t => `<option>${t.label}</option>`).join('');
  U.fillSharedSelects(L);
  for (const id of ['sourceType', 'region', 'particle', 'locale']) {
    $(id).addEventListener('change', syncDerived);
  }
  syncDerived();
  U.addScenarioRow(L);
  $('addScenario').addEventListener('click', () => U.addScenarioRow(L));
  $('run').addEventListener('click', run);
  $('showAll').addEventListener('change', () => lastResult && render(lastResult));
  U.attachCsvDownload($('exportCsv'), () => lastResult, toCsv, 'point');
})();
