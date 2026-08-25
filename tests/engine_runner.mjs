// Runs engine.js over the cases in cases.json and writes engine_out.json.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculate, runFileName } from '../engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');
const L = JSON.parse(fs.readFileSync(path.join(site, 'data/lookups.json')));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'cases.json')));

const out = cases.map(c => {
  const file = runFileName({
    particle: L.particleSizes.find(p => p.label === c.particleLabel).slug,
    locale: c.locale,
    met: L.climateRegions.find(r => r.region === c.region).met,
    emissionType: c.emissionType,
  });
  const buf = fs.readFileSync(path.join(site, 'data/pf', file));
  const grid = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const res = calculate(grid, c.scenarios, {
    area: c.area, particleLabel: c.particleLabel, locale: c.locale,
    caps: L.fugitiveCaps, receptors: L.receptors, lifetime: L.lifetime,
    scaling: L.fugitiveScalingB, referenceArea: L.fugitiveScalingReferenceArea,
    rateConstant: L.emissionRateConstant,
  });
  return { name: c.name, file, scalingFactors: res.scalingFactors, rows: res.rows };
});

fs.writeFileSync(path.join(here, 'engine_out.json'), JSON.stringify(out, null, 1));
console.log(`engine_runner: ${out.length} cases -> engine_out.json`);
