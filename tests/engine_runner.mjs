// Runs engine.js over the cases in cases.json and writes engine_out.json.
// Each case names its source path; the run file, caps and scaling all follow
// from that, exactly as the corresponding page does.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculate, runFileName, pointRunFileName } from '../engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');
const L = JSON.parse(fs.readFileSync(path.join(site, 'data/lookups.json')));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'cases.json')));

const out = cases.map(c => {
  const source = c.source ?? 'fugitive';
  const common = {
    particle: L.particleSizes.find(p => p.label === c.particleLabel).slug,
    locale: c.locale,
    met: L.climateRegions.find(r => r.region === c.region).met,
    emissionType: c.emissionType,
  };
  const file = source === 'point'
    ? pointRunFileName({
        sourceType: L.pointSourceTypes.find(t => t.label === c.sourceType).slug,
        ...common,
      })
    : runFileName(common);

  const buf = fs.readFileSync(path.join(site, 'data/pf', file));
  const grid = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

  const opts = {
    area: c.area, particleLabel: c.particleLabel, locale: c.locale,
    receptors: L.receptors, lifetime: L.lifetime,
    rateConstant: L.emissionRateConstant,
    ...(source === 'point'
      ? { caps: L.pointCaps, scaling: null }
      : { caps: L.fugitiveCaps, scaling: L.fugitiveScalingB,
          referenceArea: L.fugitiveScalingReferenceArea }),
  };
  const res = calculate(grid, c.scenarios, opts);
  return { name: c.name, source, file, scalingFactors: res.scalingFactors, rows: res.rows };
});

fs.writeFileSync(path.join(here, 'engine_out.json'), JSON.stringify(out, null, 1));
console.log(`engine_runner: ${out.length} cases -> engine_out.json`);
