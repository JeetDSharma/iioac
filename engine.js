// IIOAC fugitive source engine — a direct port of the workbook's
// "Fugitive Calculations" / "Fugitive Output Prelim" chain.

// Column offsets into a run file's 60 columns. Each group holds four columns,
// one per emission duration (1, 4, 8, 24 hr/day).
export const GROUPS = {
  airDaily:  { low: 0,  central: 4,  high: 8  },
  airAnnual: { low: 12, central: 16, high: 20 },
  totalDep:  { low: 24, central: 28, high: 32 },
  wetDep:    { low: 36, central: 40, high: 44 },
  dryDep:    { low: 48, central: 52, high: 56 },
};

// Receptor bands, in the order the run files stack them: 4 blocks of 365 rows.
export const BANDS = { inner: 0, outer: 1, all: 2, community: 3 };

// 'Anywhere' is the run files' All Receptors band. The calculation sheet uses it,
// the output sheet does not report it.
export const LOCATIONS = [
  { key: 'inner',     label: 'Fenceline Avg',      inWorkbookOutput: true },
  { key: 'outer',     label: 'Outer-boundary Avg', inWorkbookOutput: true },
  { key: 'community', label: 'Community Avg',      inWorkbookOutput: true },
  { key: 'all',       label: 'Anywhere',           inWorkbookOutput: false },
];

// High-End and Mean are the two statistics the workbook's output sheet reports,
// with indoor/outdoor ratios from lookups!B58 and lookups!B57. Low-End reads the
// workbook's Min columns, which the calculation sheet computes but the output
// sheet never surfaces; it has no ratio of its own, so it borrows Mean's.
export const STATS = [
  { key: 'high',    label: 'High-End', ioRatio: 1,    inWorkbookOutput: true },
  { key: 'central', label: 'Mean',     ioRatio: 0.65, inWorkbookOutput: true },
  { key: 'low',     label: 'Low-End',  ioRatio: 0.65, inWorkbookOutput: false },
];

const COLS = 60;
const DAYS = 365;
export const GRID_LENGTH = COLS * DAYS * 4;   // 4 receptor bands

// kg/site/day spread over N hours -> g/s. The workbook uses this literal, not
// 1000/3600, so results match it digit for digit.
const DEFAULT_RATE_CONSTANT = 0.2778;

export function runFileName({ particle, locale, met, emissionType }) {
  return `results_fugitive_${particle}_${locale.toLowerCase()}_met${met}_${emissionType.toLowerCase()}.bin`;
}

export async function loadGrid(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const grid = new Float32Array(await res.arrayBuffer());
  if (grid.length !== GRID_LENGTH) {
    throw new Error(`${url} is ${grid.length} values, expected ${GRID_LENGTH}`);
  }
  return grid;
}

function unitValue(grid, band, frequency, colBase, durationCol) {
  if (!Number.isInteger(frequency) || frequency < 1 || frequency > DAYS) {
    throw new RangeError(`Release frequency must be a whole number of days 1-${DAYS}, got ${frequency}`);
  }
  const row = BANDS[band] * DAYS + (frequency - 1);
  const i = row * COLS + colBase + durationCol;
  const v = grid[i];
  if (v === undefined) throw new RangeError(`Lookup index ${i} is outside the run file`);
  return v;
}

// (a * area^b) / (a * 100^b) reduces to (area / 100)^b.
export function scalingFactors(area, particleLabel, locale, table, referenceArea = 100) {
  const b = table[particleLabel + locale];
  if (!b) throw new Error(`No fugitive scaling coefficients for "${particleLabel}" + "${locale}"`);
  if (!(area > 0)) throw new RangeError(`Area of source must be greater than 0, got ${area}`);
  const f = {};
  for (const k of Object.keys(b)) f[k] = Math.pow(area / referenceArea, b[k]);
  return f;
}

/**
 * @param grid      Float32Array from the matching run file
 * @param scenarios [{ name, amount, hours, durationCol, frequency }]
 * @param opts      { area, particleLabel, locale, caps, receptors, lifetime, scaling }
 * @returns rows keyed by `${stat}|${location}`
 */
export function calculate(grid, scenarios, opts) {
  const sf = scalingFactors(opts.area, opts.particleLabel, opts.locale, opts.scaling,
                            opts.referenceArea);
  if (!(opts.particleLabel in opts.caps)) {
    throw new Error(`No cap entry for particle size "${opts.particleLabel}"`);
  }
  if (!scenarios.length) throw new Error('At least one emission scenario is required');
  const caps = opts.caps[opts.particleLabel];
  const rateConstant = opts.rateConstant ?? DEFAULT_RATE_CONSTANT;
  const rows = [];

  for (const stat of STATS) {
    for (const loc of LOCATIONS) {
      const totals = { airDaily: 0, airAnnual: 0, totalDep: 0, wetDep: 0, dryDep: 0 };

      for (const group of Object.keys(GROUPS)) {
        // The workbook only scales and caps a block when a cap exists for it.
        // Deposition blocks and vapor air have no cap, so they get neither.
        const cap = group === 'airDaily' ? caps.dailyAir
                  : group === 'airAnnual' ? caps.annualAir
                  : null;
        const factor = cap == null ? 1 : sf[loc.key];

        for (const s of scenarios) {
          const rate = (s.amount / s.hours) * rateConstant;
          const unit = unitValue(grid, loc.key, s.frequency, GROUPS[group][stat.key], s.durationCol);
          let v = rate * unit * factor;
          if (cap != null && v > cap) v = cap;
          totals[group] += v;
        }
      }

      const outdoorDaily = totals.airDaily;
      const outdoorAnnual = totals.airAnnual;
      const indoorDaily = outdoorDaily * stat.ioRatio;
      const indoorAnnual = outdoorAnnual * stat.ioRatio;

      const acute = opts.receptors.map(r =>
        ((r.pctIndoor * indoorDaily + r.pctOutdoor * outdoorDaily) * r.inhAcute * 24 * 0.001) / r.bw);
      const chronic = opts.receptors.map(r =>
        ((r.pctIndoor * indoorAnnual + r.pctOutdoor * outdoorAnnual) * r.inhChronic * 0.001) / r.bw);
      const L = opts.lifetime;
      const lifetime =
        ((L.pctIndoor * indoorAnnual + L.pctOutdoor * outdoorAnnual) * L.inhChronic * 33 * 0.001) / (L.bw * 78);

      rows.push({
        stat: stat.label, statKey: stat.key, location: loc.label, locationKey: loc.key,
        outdoorDaily, outdoorAnnual, indoorDaily, indoorAnnual,
        totalDep: totals.totalDep, wetDep: totals.wetDep, dryDep: totals.dryDep,
        acute, chronic, lifetime,
        inWorkbookOutput: stat.inWorkbookOutput && loc.inWorkbookOutput,
      });
    }
  }
  return { rows, scalingFactors: sf, caps, rateConstant };
}
