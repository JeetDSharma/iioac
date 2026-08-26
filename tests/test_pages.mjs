// Every source path has its own page but shares ui.js, so a page that is missing
// one element id fails at runtime rather than at import. This walks each page's
// module graph, collects the ids those modules ask for, and checks the HTML has
// them. It is the cheap stand-in for opening each page in a browser.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');

const PAGES = [
  { html: 'index.html', entry: 'app.js' },
  { html: 'point.html', entry: 'point.js' },
];

// Ids the scripts create at runtime rather than expecting in the markup.
const RUNTIME_IDS = new Set();

function moduleGraph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(path.join(site, entry), 'utf8');
  for (const m of src.matchAll(/from\s+'\.\/([\w.-]+)'/g)) moduleGraph(m[1], seen);
  return seen;
}

function idsUsedBy(modules) {
  const ids = new Set();
  for (const mod of modules) {
    const src = fs.readFileSync(path.join(site, mod), 'utf8');
    for (const m of src.matchAll(/\$\('([\w-]+)'\)/g)) ids.add(m[1]);
    for (const m of src.matchAll(/getElementById\('([\w-]+)'\)/g)) ids.add(m[1]);
  }
  return ids;
}

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (detail ? `  — ${detail}` : ''));
  if (!ok) failed++;
};

for (const page of PAGES) {
  const html = fs.readFileSync(path.join(site, page.html), 'utf8');
  const present = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const mods = moduleGraph(page.entry);
  const wanted = [...idsUsedBy(mods)].filter(id => !RUNTIME_IDS.has(id));
  const missing = wanted.filter(id => !present.has(id));
  check(`${page.html} has every id ${page.entry} and its imports use`,
        missing.length === 0,
        missing.length ? `missing ${missing.join(', ')}` : `${wanted.length} ids across ${mods.size} modules`);

  check(`${page.html} loads ${page.entry} as a module`,
        html.includes(`<script type="module" src="${page.entry}">`));

  check(`${page.html} carries a version meta tag`,
        /<meta name="iioac-version" content="[^"]+">/.test(html));

  check(`${page.html} has the build stamp marker`,
        /<a id="build" href="[^"]*">[^<]*<\/a>/.test(html));
}

// The build stamp script must know about every page, or a new page ships as "dev".
const stamp = fs.readFileSync(path.join(site, 'tools/stamp_version.mjs'), 'utf8');
const stamped = [...stamp.matchAll(/'([\w.-]+\.html)'/g)].map(m => m[1]);
check('stamp_version.mjs stamps every page',
      PAGES.every(p => stamped.includes(p.html)),
      `stamps ${stamped.join(', ')}`);

console.log(`\ntest_pages.mjs: ${failed ? failed + ' failed' : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
