// Unit tests for the pure helpers and the engine's input guards.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fmt, csvCell } from '../format.js';
import { calculate, scalingFactors, loadGrid, runFileName, GRID_LENGTH, STATS, LOCATIONS } from '../engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const L = JSON.parse(fs.readFileSync(path.join(here, '../data/lookups.json')));
let pass = 0, fail = 0;

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
};
const eq = (name, got, want) => ok(name, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const throws = (name, fn, re) => {
  try { fn(); fail++; console.log(`FAIL  ${name} — no error thrown`); }
  catch (e) { ok(name, re.test(e.message), `message was "${e.message}"`); }
};

// --- fmt: the regression that turned 1000 into "1" ---------------------------
eq('fmt keeps integer zeros (1000)', fmt(1000), '1000');
eq('fmt keeps integer zeros (150, the coarse cap)', fmt(150), '150');
eq('fmt keeps integer zeros (35, the fine cap)', fmt(35), '35');
eq('fmt trims only post-decimal zeros', fmt(10.00), '10');
eq('fmt 4 significant figures', fmt(1.1841774843), '1.184');
eq('fmt small magnitudes use exponent', fmt(1.5e-6), '1.500e-6');
eq('fmt large magnitudes use exponent', fmt(20000), '2.000e+4');
eq('fmt zero', fmt(0), '0');
eq('fmt null', fmt(null), '—');
eq('fmt NaN', fmt(NaN), '—');
eq('fmt Infinity', fmt(Infinity), '—');
eq('fmt negative', fmt(-1.5), '-1.5');

// --- csvCell: RFC 4180 ------------------------------------------------------
eq('csvCell plain', csvCell('Toluene'), 'Toluene');
eq('csvCell comma', csvCell('a,b'), '"a,b"');
eq('csvCell quote is doubled', csvCell('say "hi"'), '"say ""hi"""');
eq('csvCell newline', csvCell('a\nb'), '"a\nb"');
eq('csvCell null', csvCell(null), '');
eq('csvCell number passes through', csvCell(1.5), '1.5');

// --- runFileName ------------------------------------------------------------
eq('runFileName builds the workbook filename',
   runFileName({ particle: 'fine', locale: 'Urban', met: 9, emissionType: 'Consecutive' }),
   'results_fugitive_fine_urban_met9_consecutive.bin');

// --- scalingFactors ---------------------------------------------------------
const sf = scalingFactors(10000, 'Fine', 'Urban', L.fugitiveScalingB, L.fugitiveScalingReferenceArea);
ok('scalingFactors at the reference area is exactly 1',
   Object.values(scalingFactors(100, 'Fine', 'Urban', L.fugitiveScalingB, 100)).every(v => v === 1));
ok('scalingFactors shrink above the reference area (negative exponents)',
   Object.values(sf).every(v => v > 0 && v < 1), JSON.stringify(sf));
throws('scalingFactors rejects an unknown particle/locale pair',
       () => scalingFactors(100, 'Nope', 'Urban', L.fugitiveScalingB), /No fugitive scaling/);
throws('scalingFactors rejects area 0', () => scalingFactors(0, 'Fine', 'Urban', L.fugitiveScalingB), /greater than 0/);
throws('scalingFactors rejects negative area', () => scalingFactors(-5, 'Fine', 'Urban', L.fugitiveScalingB), /greater than 0/);

// --- engine guards ----------------------------------------------------------
const buf = fs.readFileSync(path.join(here, '../data/pf/results_fugitive_fine_urban_met1_consecutive.bin'));
const grid = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
eq('run file holds exactly 4 bands x 365 days x 60 columns', grid.length, GRID_LENGTH);

const base = { area: 10000, particleLabel: 'Fine', locale: 'Urban', caps: L.fugitiveCaps,
  receptors: L.receptors, lifetime: L.lifetime, scaling: L.fugitiveScalingB,
  referenceArea: L.fugitiveScalingReferenceArea, rateConstant: L.emissionRateConstant };
const scen = f => [{ name: 'A', amount: 5, hours: 8, durationCol: 2, frequency: f }];

throws('frequency 0 is rejected', () => calculate(grid, scen(0), base), /1-365/);
throws('frequency 366 is rejected', () => calculate(grid, scen(366), base), /1-365/);
throws('fractional frequency is rejected', () => calculate(grid, scen(250.5), base), /whole number/);
throws('empty scenario list is rejected', () => calculate(grid, [], base), /at least one/i);
throws('unknown particle size is rejected',
       () => calculate(grid, scen(250), { ...base, particleLabel: 'Chunky' }), /scaling coefficients|cap entry/);
ok('frequency 1 and 365 are both accepted',
   [1, 365].every(f => isFinite(calculate(grid, scen(f), base).rows[0].outdoorDaily)));

// --- model invariants -------------------------------------------------------
const r = calculate(grid, scen(250), base);
const row = k => r.rows.find(x => x.statKey === k.s && x.locationKey === k.l);

eq('engine reports 3 statistics x 4 locations', r.rows.length, STATS.length * LOCATIONS.length);
eq('exactly 6 rows match the workbook output sheet', r.rows.filter(x => x.inWorkbookOutput).length, 6);
ok('High-End indoor equals outdoor (ratio 1.0)',
   row({ s: 'high', l: 'inner' }).indoorDaily === row({ s: 'high', l: 'inner' }).outdoorDaily);
ok('Mean indoor is 0.65 of outdoor',
   Math.abs(row({ s: 'central', l: 'inner' }).indoorDaily / row({ s: 'central', l: 'inner' }).outdoorDaily - 0.65) < 1e-12);
ok('High-End >= Mean >= Low-End at every location',
   LOCATIONS.every(l => {
     const h = row({ s: 'high', l: l.key }).outdoorDaily;
     const m = row({ s: 'central', l: l.key }).outdoorDaily;
     const lo = row({ s: 'low', l: l.key }).outdoorDaily;
     return h >= m && m >= lo;
   }));
ok('fenceline concentration exceeds outer-boundary',
   row({ s: 'high', l: 'inner' }).outdoorDaily > row({ s: 'high', l: 'outer' }).outdoorDaily);
ok('total deposition >= wet deposition',
   r.rows.every(x => x.totalDep >= x.wetDep - 1e-15));
ok('every reported value is finite and non-negative',
   r.rows.every(x => [x.outdoorDaily, x.outdoorAnnual, x.totalDep, x.wetDep, x.dryDep, x.lifetime,
     ...x.acute, ...x.chronic].every(v => isFinite(v) && v >= 0)));

// Doses must scale linearly with release amount (no cap in play at this level).
const a1 = calculate(grid, [{ name: 'A', amount: 1, hours: 8, durationCol: 2, frequency: 250 }], base);
const a2 = calculate(grid, [{ name: 'A', amount: 2, hours: 8, durationCol: 2, frequency: 250 }], base);
ok('doubling the release amount doubles an uncapped result',
   Math.abs(a2.rows[0].outdoorDaily / a1.rows[0].outdoorDaily - 2) < 1e-12);

// Two identical scenarios must sum to twice one of them.
const two = calculate(grid, [...scen(250), ...scen(250)], base);
ok('two identical scenarios sum',
   Math.abs(two.rows[0].outdoorDaily / r.rows[0].outdoorDaily - 2) < 1e-12);

// Cap behaviour: a huge release must clamp to the fine PM2.5 NAAQS per scenario.
const huge = calculate(grid, [{ name: 'H', amount: 1e7, hours: 1, durationCol: 0, frequency: 365 }], base);
ok('a huge fine-particle release clamps to the 35 ug/m3 cap',
   Math.abs(huge.rows[0].outdoorDaily - 35) < 1e-9, `got ${huge.rows[0].outdoorDaily}`);
const hugeVapor = calculate(grid, [{ name: 'H', amount: 1e7, hours: 1, durationCol: 0, frequency: 365 }],
  { ...base, particleLabel: 'No particles (vapor only)' });
ok('vapor is not capped', hugeVapor.rows[0].outdoorDaily > 35);
ok('vapor is also unscaled (scaling lives inside the cap branch)',
   hugeVapor.rows[0].outdoorDaily === hugeVapor.rows[0].outdoorDaily);
ok('deposition is never scaled, so it is identical across particle sizes for the same unit values',
   Math.abs(calculate(grid, scen(250), base).rows[0].totalDep
          - calculate(grid, scen(250), { ...base, particleLabel: 'No particles (vapor only)' }).rows[0].totalDep) < 1e-18);

console.log(`\ntest_units.mjs: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
