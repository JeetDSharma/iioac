// Stamps the deployed commit into the footer so the page can say which code
// produced the numbers on screen. Vercel sets VERCEL_GIT_COMMIT_SHA during the
// build; falls back to local git, and leaves the "dev" placeholder if neither
// is available (opening the file directly, or a tarball with no .git).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REPO = 'https://github.com/JeetDSharma/iioac';
const MARKER = /<a id="build" href="[^"]*">[^<]*<\/a>/;

function commitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const sha = commitSha();
if (!sha) {
  console.log('stamp_version: no commit sha available, leaving the dev placeholder');
  process.exit(0);
}

// One page per IIOAC source path; every one carries the same build stamp.
const PAGES = ['index.html', 'point.html'];

for (const page of PAGES) {
  const html = readFileSync(page, 'utf8');
  if (!MARKER.test(html)) {
    console.error(`stamp_version: build marker not found in ${page}`);
    process.exit(1);
  }
  writeFileSync(page, html.replace(
    MARKER,
    `<a id="build" href="${REPO}/commit/${sha}">${sha.slice(0, 7)}</a>`
  ));
}
console.log(`stamp_version: stamped ${sha.slice(0, 7)} into ${PAGES.join(', ')}`);
