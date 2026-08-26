import { calculate, loadGrid, runFileName } from './engine.js';
import { fmt, csvCell } from './format.js';

const $ = id => document.getElementById(id);
const gridCache = new Map();
let L, lastResult = null;

function readChemical() {
  const num = id => ($(id).value === '' ? null : Number($(id).value));
  return {
    name: $('chemName').value.trim(),
    cas: $('chemCas').value.trim(),
    vaporPressure: num('chemVp'),
    solubility: num('chemSol'),
    koc: num('chemKoc'),
    halfLife: num('chemHalfLife'),
    molecularWeight: num('chemMw'),
  };
}

function chemicalLabel(chem) {
  if (chem.name && chem.cas) return `${chem.name} (CAS ${chem.cas})`;
  return chem.name || (chem.cas && `CAS ${chem.cas}`) || 'unnamed chemical';
}

function slugFor(label) {
  return L.particleSizes.find(p => p.label === label).slug;
}

function syncDerived() {
  const region = L.climateRegions.find(r => r.region === $('region').value);
  $('surface').value = region.surface;
  $('upperair').value = region.upperAir;
  const particle = L.particleSizes.find(p => p.label === $('particle').value);
  $('diameter').value = particle.diameter ?? 'N/A for Vapor';
  $('density').value = particle.density ?? 'N/A for Vapor';
  $('population').value = L.population[$('locale').value];
}

function addScenarioRow(preset = {}) {
  const tr = document.createElement('tr');
  const n = $('scenarioRows').children.length + 1;
  tr.innerHTML = `
    <td><input class="s-name" type="text" value="${preset.name ?? 'Scenario ' + n}"></td>
    <td><input class="s-amount" type="number" min="0" step="any" value="${preset.amount ?? 1}"></td>
    <td><select class="s-duration">${
      L.emissionDurations.map(d => `<option value="${d.col}" data-hours="${d.hours}">${d.label}</option>`).join('')
    }</select></td>
    <td><input class="s-frequency" type="number" min="1" max="365" step="1" value="${preset.frequency ?? 250}"></td>
    <td><button class="ghost s-remove" title="Remove">×</button></td>`;
  tr.querySelector('.s-remove').addEventListener('click', () => tr.remove());
  if (preset.durationCol != null) tr.querySelector('.s-duration').value = preset.durationCol;
  $('scenarioRows').append(tr);
}

function readScenarios() {
  return [...$('scenarioRows').children].map(tr => {
    const sel = tr.querySelector('.s-duration');
    const frequency = Math.round(Number(tr.querySelector('.s-frequency').value));
    return {
      name: tr.querySelector('.s-name').value.trim() || 'Scenario',
      amount: Number(tr.querySelector('.s-amount').value),
      hours: Number(sel.selectedOptions[0].dataset.hours),
      durationLabel: sel.selectedOptions[0].textContent.trim(),
      durationCol: Number(sel.value),
      frequency,
    };
  });
}

function validate(scenarios) {
  if (!(Number($('area').value) > 0)) return 'Enter an area of source greater than 0.';
  if (!scenarios.length) return 'Add at least one emission scenario.';
  for (const s of scenarios) {
    if (!(s.amount > 0)) return `"${s.name}": release amount must be greater than 0.`;
    if (!(s.frequency >= 1 && s.frequency <= 365)) return `"${s.name}": frequency must be 1–365 days/year.`;
  }
  return null;
}

function visibleRows(rows) {
  return $('showAll').checked
    ? rows
    : rows.filter(r => r.statKey !== 'low' && r.locationKey !== 'all');
}

function renderTable(el, headers, rows, cells) {
  const head = `<thead><tr>${headers.map(h =>
    `<th${h.left ? ' class="left"' : ''}>${h.label}${h.sub ? `<span>${h.sub}</span>` : ''}</th>`).join('')}</tr></thead>`;
  const body = rows.map(r =>
    `<tr class="${r.statKey === 'central' ? 'mean' : ''}">${cells(r).map((c, i) =>
      i < 2 ? `<td class="left">${c}</td>` : `<td class="num">${c}</td>`).join('')}</tr>`).join('');
  el.innerHTML = head + `<tbody>${body}</tbody>`;
}

function render(result) {
  const rows = visibleRows(result.rows);
  $('runTitle').textContent = chemicalLabel(result.chemical);

  renderTable($('concTable'), [
    { label: 'Statistic', left: true }, { label: 'Location', left: true },
    { label: 'Outdoor air', sub: 'daily µg/m³' }, { label: 'Outdoor air', sub: 'annual µg/m³' },
    { label: 'Indoor air', sub: 'daily µg/m³' }, { label: 'Indoor air', sub: 'annual µg/m³' },
    { label: 'Total dep.', sub: 'g/m²' }, { label: 'Wet dep.', sub: 'g/m²' }, { label: 'Dry dep.', sub: 'g/m²' },
  ], rows, r => [r.stat, r.location, fmt(r.outdoorDaily), fmt(r.outdoorAnnual),
    fmt(r.indoorDaily), fmt(r.indoorAnnual), fmt(r.totalDep), fmt(r.wetDep), fmt(r.dryDep)]);

  const people = L.receptors.map(p => ({ label: p.name, sub: p.ages }));
  renderTable($('acuteTable'),
    [{ label: 'Statistic', left: true }, { label: 'Location', left: true }, ...people],
    rows, r => [r.stat, r.location, ...r.acute.map(fmt)]);

  renderTable($('chronicTable'),
    [{ label: 'Statistic', left: true }, { label: 'Location', left: true }, ...people,
     { label: L.lifetime.name, sub: L.lifetime.ages }],
    rows, r => [r.stat, r.location, ...r.chronic.map(fmt), fmt(r.lifetime)]);

  const sf = result.scalingFactors;
  const caps = result.caps;
  const notes = [
    `Area scaling factors (area / 100 m²)^b: fenceline ${sf.inner.toFixed(4)}, ` +
    `outer-boundary ${sf.outer.toFixed(4)}, community ${sf.community.toFixed(4)}, anywhere ${sf.all.toFixed(4)}.`,
    caps.dailyAir != null
      ? `Air concentrations are capped at the PM NAAQS (${caps.dailyAir} µg/m³) per scenario before summing, as in the workbook.`
      : 'Vapor has no air concentration cap in the workbook, so no cap is applied.',
    'Following the workbook, the area scaling factor is applied only to blocks that carry a cap. ' +
    'Deposition (and all vapor results) are therefore reported unscaled. This mirrors IIOAC 1.0 exactly.',
    'Indoor air uses the workbook ratios: 1.0 for High-End (lookups!B58) and 0.65 for Mean ' +
    '(lookups!B57).',
    $('showAll').checked
      ? 'Low-End and Anywhere rows are shown. Their concentrations come from the workbook\'s Min ' +
        'and All Receptors columns, but its output sheet never reports them, so their indoor air ' +
        'and doses are an extension of the model, not a workbook result. Low-End borrows the Mean ratio.'
      : 'Showing the six rows the IIOAC output sheet reports. Tick the box above for the Low-End ' +
        'and Anywhere rows the calculation sheet computes but never reports.',
    `Doses combine indoor and outdoor air weighted by each receptor's activity pattern.`,
    'Chemical properties do not enter the fugitive calculation. IIOAC greys them out for this ' +
    'source type. Only the chemical name and CAS number identify the run.',
  ];
  $('notes').innerHTML = notes.map(n => `<li>${n}</li>`).join('');
  $('results').hidden = false;
}

function toCsv(result) {
  const chem = result.chemical;
  const r = result.run;
  const src = r.source;

  // A results file that cannot say what produced it cannot be checked against
  // the workbook, so the export leads with the run rather than the numbers.
  const rows = [
    ['Run'],
    ['Exported', r.exported],
    ['Tool', `IIOAC fugitive source (web port) ${r.version}`],
    ['Build', r.build],
    ['Cite', CITE],
    ['EPA model', r.epaModel ? `IIOAC ${r.epaModel}` : 'IIOAC 1.0'],
    ['Dispersion run file', r.file],
    [],
    ['Chemical'],
    ['Chemical name', chem.name], ['CAS number', chem.cas],
    ['Vapor pressure (Torr)', chem.vaporPressure], ['Solubility (mg/L)', chem.solubility],
    ['Org. carbon sorption coeff. Koc (mL/g)', chem.koc],
    ['Volatilization half-life (hrs)', chem.halfLife],
    ['Molecular weight (g/mol)', chem.molecularWeight],
    ['', 'Collected and exported, but no fugitive formula reads them.'],
    [],
    ['Source parameters'],
    ['Area of source (m2)', src.area],
    ['Release height (m)', src.height],
    ['Urban or rural', src.locale],
    ['Population', src.population],
    ['Particle size', src.particle],
    ['Mean aerodynamic diameter (um)', src.diameter],
    ['Density (g/cm3)', src.density],
    ['Climate region', src.region],
    ['Surface station', src.surface],
    ['Upper-air station', src.upperair],
    ['Release pattern', src.emissionType],
    [],
    ['Emission scenarios'],
    ['Scenario name', 'Release amount (kg/site/day)', 'Release duration', 'Release frequency (days/year)'],
    ...r.scenarios.map(s => [s.name, s.amount, s.durationLabel, s.frequency]),
    [],
    ['Results'],
  ];

  const head = ['Statistic', 'Location', 'Outdoor air daily (ug/m3)', 'Outdoor air annual (ug/m3)',
    'Indoor air daily (ug/m3)', 'Indoor air annual (ug/m3)', 'Total deposition (g/m2)',
    'Wet deposition (g/m2)', 'Dry deposition (g/m2)',
    ...L.receptors.map(p => `Acute dose ${p.name} (mg/kg/day)`),
    ...L.receptors.map(p => `Chronic dose ${p.name} (mg/kg/day)`),
    'Chronic dose Lifetime (mg/kg/day)', 'Reported by IIOAC workbook'];
  const lines = result.rows.map(r => [r.stat, r.location, r.outdoorDaily, r.outdoorAnnual,
    r.indoorDaily, r.indoorAnnual, r.totalDep, r.wetDep, r.dryDep, ...r.acute, ...r.chronic, r.lifetime,
    r.inWorkbookOutput ? 'yes' : 'no']);
  return [...rows, head, ...lines].map(row => row.map(csvCell).join(',')).join('\n');
}

async function run() {
  const status = $('status');
  const scenarios = readScenarios();
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
    particle: slugFor(particleLabel),
    locale: $('locale').value,
    met: L.climateRegions.find(r => r.region === $('region').value).met,
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
    lastResult.chemical = readChemical();
    lastResult.run = {
      exported: new Date().toISOString(),
      version: document.querySelector('meta[name="iioac-version"]')?.content || 'unknown',
      build: $('build').textContent,
      epaModel,
      file,
      scenarios,
      source: {
        area: Number($('area').value),
        height: $('height').value,
        locale: $('locale').value,
        population: $('population').value,
        particle: particleLabel,
        diameter: $('diameter').value,
        density: $('density').value,
        region: $('region').value,
        surface: $('surface').value,
        upperair: $('upperair').value,
        emissionType: $('emissionType').value,
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

const RUNS = 'https://github.com/JeetDSharma/iioac/actions/workflows/watch-epa.yml';
// Concept DOI: always resolves to the newest release. Zenodo also mints one per
// version, and its landing page lists them.
const CITE = 'https://doi.org/10.5281/zenodo.22101723';
let epaModel = null;   // filled from data/epa-version.json, for the CSV preamble

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function showEpaStatus() {
  // Disclosure only. A failure here must never stop the calculator working.
  try {
    const res = await fetch('data/epa-version.json');
    if (!res.ok) return;
    const v = await res.json();
    epaModel = v.portedEpaVersion;

    if (v.upstreamChanged) {
      const on = v.upstreamChangedOn ? ` on ${longDate(v.upstreamChangedOn)}` : '';
      const issue = v.issueUrl ? ` <a href="${v.issueUrl}">Tracking issue</a>.` : '';
      $('staleDetail').innerHTML =
        `The distribution changed${on}. This page implements EPA IIOAC ${v.portedEpaVersion}, ` +
        `so its numbers may no longer match EPA's current model.${issue}`;
      $('staleNotice').hidden = false;
      return;
    }

    // The date is refreshed monthly, not weekly, so it is worded as the last
    // recorded check rather than implying one happened this week.
    $('verifyLine').innerHTML =
      `Matches EPA's published IIOAC ${v.portedEpaVersion} distribution as of ` +
      `${longDate(v.lastChecked)}. A <a href="${RUNS}">weekly job</a> re-checks it; ` +
      `if EPA republishes, a notice appears here.`;
    $('verifyLine').hidden = false;
  } catch { /* offline, or served without the file */ }
}

(async function init() {
  showEpaStatus();
  try {
    const res = await fetch('data/lookups.json');
    if (!res.ok) throw new Error(`lookups.json returned ${res.status}`);
    L = await res.json();
  } catch (err) {
    $('status').textContent = `Could not load lookup data: ${err.message}. Serve the site over HTTP (./serve.sh).`;
    $('status').classList.add('error');
    $('run').disabled = true;
    return;
  }
  $('particle').innerHTML = L.particleSizes.map(p => `<option>${p.label}</option>`).join('');
  $('region').innerHTML = L.climateRegions.map(r => `<option>${r.region}</option>`).join('');
  for (const id of ['region', 'particle', 'locale']) $(id).addEventListener('change', syncDerived);
  syncDerived();
  addScenarioRow();
  $('addScenario').addEventListener('click', () => addScenarioRow());
  $('run').addEventListener('click', run);
  $('showAll').addEventListener('change', () => lastResult && render(lastResult));
  $('exportCsv').addEventListener('click', () => {
    const blob = new Blob([toCsv(lastResult)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // Named per run: a reviewer comparing several exports should not have to
    // rename files to tell them apart.
    const slug = (lastResult.chemical.name || 'run').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
    a.download = `iioac-fugitive-${slug}-${lastResult.run.exported.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
