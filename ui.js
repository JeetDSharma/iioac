// Shared page machinery for every source path.
//
// Nothing here knows which source path is on screen. Anything that differs
// between Point, Fugitive, Area Soil and Area Water lives in that path's own
// controller (app.js, point.js, ...) so the pages can follow their own
// workbook sheet's input order and wording without fighting an abstraction.

export const $ = id => document.getElementById(id);

export const RUNS = 'https://github.com/JeetDSharma/iioac/actions/workflows/watch-epa.yml';
// Concept DOI: always resolves to the newest release. Zenodo also mints one per
// version, and its landing page lists them.
export const CITE = 'https://doi.org/10.5281/zenodo.22101723';

export async function loadLookups() {
  const res = await fetch('data/lookups.json');
  if (!res.ok) throw new Error(`lookups.json returned ${res.status}`);
  return res.json();
}

/* ---------- chemical ---------- */

export function readChemical() {
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

export function chemicalLabel(chem) {
  if (chem.name && chem.cas) return `${chem.name} (CAS ${chem.cas})`;
  return chem.name || (chem.cas && `CAS ${chem.cas}`) || 'unnamed chemical';
}

export function chemicalCsvRows(chem, note) {
  return [
    ['Chemical'],
    ['Chemical name', chem.name], ['CAS number', chem.cas],
    ['Vapor pressure (Torr)', chem.vaporPressure], ['Solubility (mg/L)', chem.solubility],
    ['Org. carbon sorption coeff. Koc (mL/g)', chem.koc],
    ['Volatilization half-life (hrs)', chem.halfLife],
    ['Molecular weight (g/mol)', chem.molecularWeight],
    ['', note],
  ];
}

/* ---------- emission scenarios ---------- */
// Step 3 is identical on the Point and Fugitive input sheets: the same four
// columns, the same four release durations, the same 1-365 day frequency.

export function addScenarioRow(L, preset = {}) {
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

export function readScenarios() {
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

export function validateScenarios(scenarios) {
  if (!scenarios.length) return 'Add at least one emission scenario.';
  for (const s of scenarios) {
    if (!(s.amount > 0)) return `"${s.name}": release amount must be greater than 0.`;
    if (!(s.frequency >= 1 && s.frequency <= 365)) return `"${s.name}": frequency must be 1–365 days/year.`;
  }
  return null;
}

export function scenarioCsvRows(scenarios) {
  return [
    ['Emission scenarios'],
    ['Scenario name', 'Release amount (kg/site/day)', 'Release duration', 'Release frequency (days/year)'],
    ...scenarios.map(s => [s.name, s.amount, s.durationLabel, s.frequency]),
  ];
}

/* ---------- shared source parameters ---------- */
// Step 2 ("Location and Deposition Settings") is byte-identical on the Point and
// Fugitive input sheets, down to the cell addresses.

export function syncSharedDerived(L) {
  const region = L.climateRegions.find(r => r.region === $('region').value);
  $('surface').value = region.surface;
  $('upperair').value = region.upperAir;
  const particle = L.particleSizes.find(p => p.label === $('particle').value);
  $('diameter').value = particle.diameter ?? 'N/A for Vapor';
  $('density').value = particle.density ?? 'N/A for Vapor';
  $('population').value = L.population[$('locale').value];
}

export function fillSharedSelects(L) {
  $('particle').innerHTML = L.particleSizes.map(p => `<option>${p.label}</option>`).join('');
  $('region').innerHTML = L.climateRegions.map(r => `<option>${r.region}</option>`).join('');
}

export function slugFor(L, label) {
  return L.particleSizes.find(p => p.label === label).slug;
}

export function metFor(L) {
  return L.climateRegions.find(r => r.region === $('region').value).met;
}

// The Step 2 half of the run record, in the order the input sheets list it.
export function sharedSourceRecord() {
  return {
    locale: $('locale').value,
    population: $('population').value,
    particle: $('particle').value,
    diameter: $('diameter').value,
    density: $('density').value,
    region: $('region').value,
    surface: $('surface').value,
    upperair: $('upperair').value,
    emissionType: $('emissionType').value,
  };
}

export function sharedSourceCsvRows(src) {
  return [
    ['Urban or rural', src.locale],
    ['Population', src.population],
    ['Particle size', src.particle],
    ['Mean aerodynamic diameter (um)', src.diameter],
    ['Density (g/cm3)', src.density],
    ['Climate region', src.region],
    ['Surface station', src.surface],
    ['Upper-air station', src.upperair],
    ['Release pattern', src.emissionType],
  ];
}

/* ---------- results ---------- */

export function visibleRows(rows) {
  return $('showAll').checked
    ? rows
    : rows.filter(r => r.statKey !== 'low' && r.locationKey !== 'all');
}

export function renderTable(el, headers, rows, cells) {
  const head = `<thead><tr>${headers.map(h =>
    `<th${h.left ? ' class="left"' : ''}>${h.label}${h.sub ? `<span>${h.sub}</span>` : ''}</th>`).join('')}</tr></thead>`;
  const body = rows.map(r =>
    `<tr class="${r.statKey === 'central' ? 'mean' : ''}">${cells(r).map((c, i) =>
      i < 2 ? `<td class="left">${c}</td>` : `<td class="num">${c}</td>`).join('')}</tr>`).join('');
  el.innerHTML = head + `<tbody>${body}</tbody>`;
}

export function renderResultTables(L, result, fmt) {
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
}

export function renderNotes(notes) {
  $('notes').innerHTML = notes.map(n => `<li>${n}</li>`).join('');
  $('results').hidden = false;
}

// The notes every source path shares. Each page prepends its own, because the
// scaling and chemical-property wording is genuinely path-specific.
// `afterCaps` is spliced in directly after the cap note so each page keeps the
// note ordering its own source path had.
export function commonNotes(caps, afterCaps = []) {
  return [
    caps.dailyAir != null
      ? `Air concentrations are capped at the PM NAAQS (${caps.dailyAir} µg/m³) per scenario before summing, as in the workbook.`
      : 'Vapor has no air concentration cap in the workbook, so no cap is applied.',
    ...afterCaps,
    'Indoor air uses the workbook ratios: 1.0 for High-End (lookups!B58) and 0.65 for Mean ' +
    '(lookups!B57).',
    $('showAll').checked
      ? 'Low-End and Anywhere rows are shown. Their concentrations come from the workbook\'s Min ' +
        'and All Receptors columns, but its output sheet never reports them, so their indoor air ' +
        'and doses are an extension of the model, not a workbook result. Low-End borrows the Mean ratio.'
      : 'Showing the six rows the IIOAC output sheet reports. Tick the box above for the Low-End ' +
        'and Anywhere rows the calculation sheet computes but never reports.',
    `Doses combine indoor and outdoor air weighted by each receptor's activity pattern.`,
  ];
}

export function resultsCsvRows(L, rows) {
  const head = ['Statistic', 'Location', 'Outdoor air daily (ug/m3)', 'Outdoor air annual (ug/m3)',
    'Indoor air daily (ug/m3)', 'Indoor air annual (ug/m3)', 'Total deposition (g/m2)',
    'Wet deposition (g/m2)', 'Dry deposition (g/m2)',
    ...L.receptors.map(p => `Acute dose ${p.name} (mg/kg/day)`),
    ...L.receptors.map(p => `Chronic dose ${p.name} (mg/kg/day)`),
    'Chronic dose Lifetime (mg/kg/day)', 'Reported by IIOAC workbook'];
  const lines = rows.map(r => [r.stat, r.location, r.outdoorDaily, r.outdoorAnnual,
    r.indoorDaily, r.indoorAnnual, r.totalDep, r.wetDep, r.dryDep, ...r.acute, ...r.chronic, r.lifetime,
    r.inWorkbookOutput ? 'yes' : 'no']);
  return [['Results'], head, ...lines];
}

/* ---------- run record ---------- */

export function runHeaderCsvRows(r, toolName) {
  // A results file that cannot say what produced it cannot be checked against
  // the workbook, so the export leads with the run rather than the numbers.
  return [
    ['Run'],
    ['Exported', r.exported],
    ['Tool', `${toolName} ${r.version}`],
    ['Build', r.build],
    ['Cite', CITE],
    ['EPA model', r.epaModel ? `IIOAC ${r.epaModel}` : 'IIOAC 1.0'],
    ['Dispersion run file', r.file],
  ];
}

export function attachCsvDownload(button, getResult, toCsv, fileSlug) {
  button.addEventListener('click', () => {
    const result = getResult();
    const blob = new Blob([toCsv(result)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // Named per run: a reviewer comparing several exports should not have to
    // rename files to tell them apart.
    const slug = (result.chemical.name || 'run').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'run';
    a.download = `iioac-${fileSlug}-${slug}-${result.run.exported.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

/* ---------- upstream EPA status ---------- */

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Returns the ported EPA version for the CSV preamble, or null.
export async function showEpaStatus() {
  // Disclosure only. A failure here must never stop the calculator working.
  try {
    const res = await fetch('data/epa-version.json');
    if (!res.ok) return null;
    const v = await res.json();

    if (v.upstreamChanged) {
      const on = v.upstreamChangedOn ? ` on ${longDate(v.upstreamChangedOn)}` : '';
      const issue = v.issueUrl ? ` <a href="${v.issueUrl}">Tracking issue</a>.` : '';
      $('staleDetail').innerHTML =
        `The distribution changed${on}. This page implements EPA IIOAC ${v.portedEpaVersion}, ` +
        `so its numbers may no longer match EPA's current model.${issue}`;
      $('staleNotice').hidden = false;
      return v.portedEpaVersion;
    }

    // The date is refreshed monthly, not weekly, so it is worded as the last
    // recorded check rather than implying one happened this week.
    $('verifyLine').innerHTML =
      `Matches EPA's published IIOAC ${v.portedEpaVersion} distribution as of ` +
      `${longDate(v.lastChecked)}. A <a href="${RUNS}">weekly job</a> re-checks it; ` +
      `if EPA republishes, a notice appears here.`;
    $('verifyLine').hidden = false;
    return v.portedEpaVersion;
  } catch {
    return null;   // offline, or served without the file
  }
}

export function pageVersion() {
  return document.querySelector('meta[name="iioac-version"]')?.content || 'unknown';
}
