# Roadmap

What is ported, what is not, and what happens when EPA updates IIOAC.

## Where things stand

The workbook has 28 sheets covering four source paths. Four sheets are ported:
`Fugitive Calculations Prelim`, `Fugitive Calculations`, `Fugitive Output Prelim`,
and `Fugitive Output`.

The AERMOD data, though, is converted for every path. `tools/convert.py` reads the
whole of `IIOAC_RunFiles.zip` and writes both families at once:

| Output | Files | Covers |
|---|---|---|
| `data/pf/*.bin` | 168 | Fugitive |
| `data/pf/*.bin` | 504 | Point, including the incinerator subtypes |
| `data/area/*.json` | 14 | Area soil and area water, one per met station |

So the remaining work is calculation and interface logic, not data conversion.

| Path | Sheets | Data | Notes |
|---|---|---|---|
| Fugitive | 4 | ready | Done |
| Point | 7 | ready | Same lookup-times-emission shape as fugitive, plus stack parameters and the two `Point Aggregate` sheets, which have no fugitive analogue |
| Area soil | 5 | ready | Different in kind, see below |
| Area water | 5 | ready | Same, and doubled by the batch and continuous-flow variants |
| `All Sources Output` | 1 | n/a | Cross-path aggregation, only meaningful once a second path exists |
| `Input Import` | 1 | n/a | Bulk scenario import |

Point is next, because the data is ready and the shape is familiar.

The area paths are not more of the same. For fugitive and point the user supplies an
emission rate and the model multiplies it by a unit value. For area soil and water the
emission rate is *computed* from chemistry, which means the five chemical properties
currently collected and greyed out become live inputs, and the volatilization formulas
in `SoilCalc` and `WaterCalc` have to be ported rather than looked up. Treat them as a
separate project.

One open question before wiring the area interface: the converted set is rural only.
Confirm against the full `IIOAC_RunFiles.zip` whether EPA ships urban area runs at all,
or whether the model is rural by construction.

## When EPA updates IIOAC

EPA will publish a version past 1.0 eventually. The failure to avoid is a tool that
silently keeps reporting superseded numbers, so the plan is built around noticing
quickly and re-porting mechanically.

### Fingerprint the model, not just the results

Done. `tests/fingerprint.py` writes `tests/model_fingerprint.json`, and `run_all.sh`
fails when the workbook no longer matches it.

Two layers. The model layer is everything `tests/workbook.py` recovers from the
workbook's own formula text — the emission constant, the `INDEX` range maps, the
indoor/outdoor ratio cells, the cap rows, the scaling exponents, the receptor table —
so a diff names the number that moved. The sheets layer hashes the formula strings on
all 28 sheets, including the point and area paths that are not ported, so a change to
`SoilCalc` is noticed years before there is an extractor to notice it with; `lookups`
and `Chemical` are constants tables, so every cell is hashed there, not just formulas.

A new EPA release regenerates the fingerprint with `--write` and prints the diff: an
exact, reviewable list of what EPA changed, with `!` against the parts this port ships
today.

### Notice the release

Half built: `tools/check_epa.py` compares the `ETag`, `Last-Modified` and
`Content-Length` of EPA's zip against the baseline in `data/epa-version.json` over a
HEAD request. What is missing is the schedule and the issue.

A weekly GitHub Action checks EPA's download page: `ETag`, `Last-Modified` and
`Content-Length` on the zip, plus a hash of the version string on the landing page,
since EPA pages do not always carry stable validators. On any change it opens an issue.

### Keep old versions live

Anyone who cites a number from this tool in a regulatory comment needs that number to
still be reproducible years later. New EPA versions are therefore published alongside
the old, never over them. The EPA version becomes part of the data path
(`data/1.0/pf/...`), the URL, the CSV preamble, and the citation. Frozen versions stay
served.

### Two version numbers

The version of this software and the version of the model it ports are independent
axes. They are written together, as `1.0.0 (EPA IIOAC 1.0)`, and a change to EPA's
model forces a major bump here. The version string currently appears in three places
that must move together:

    index.html      the footer cite line
    CITATION.cff    version:
    README.md       the citation section

### One command to absorb a release

Re-porting should be a single command that fetches EPA's zip, verifies it against a
committed checksum, converts the run files, rebuilds `data/lookups.json`, runs the
oracle suite, and prints the fingerprint diff. Today those steps exist but are separate
and partly undocumented. If absorbing a release is one command plus a diff review, a
new IIOAC version is a weekend of work. If it is shell history, it does not happen.

Commit the SHA-256 checksums of EPA's distribution now, whether or not the rest is
ready. EPA may withdraw 1.0 when its successor lands, and their licence makes mirroring
the workbook awkward; the checksums are what let this port prove afterwards what it was
built against.

### What updates automatically, and what does not

Vercel already deploys every push. The temptation is to extend that into
converting and publishing a new EPA release automatically; the answer is no. The
value of this port is that its numbers are validated against the workbook's own
formulas, so a pipeline that absorbs a new model unattended would publish
unvalidated numbers, quietly. Numbers ship behind a human reading a formula diff.

What is automated instead is the *disclosure*. `.github/workflows/watch-epa.yml`
runs a weekly HEAD request against EPA's download and, on any change, records it
in `data/epa-version.json` and opens a tracking issue. The page reads that file
and shows a banner saying it may be stale. Committing the file deploys itself, so
the warning appears without anyone being at a keyboard.

The checksum baseline in `data/epa-version.json` is deliberately not advanced by
the watcher. It moves when a human has re-ported and re-validated, which keeps the
banner up until the work is actually done rather than until the robot notices.

`.github/workflows/validate.yml` runs the suites on every push and weekly. The
weekly run is the one that matters: it catches the toolchain rotting under a port
whose whole purpose is matching EPA's numbers.

### Storage

`data/` is 226 MB and committed. A second EPA version doubles that, against GitHub's
roughly 1 GB soft limit. That is affordable once. The choice between Git LFS, release
assets and object storage should be made before a third version, not during one.

## Order of work

1. ~~Commit `tools/convert.py` and the distribution checksums.~~ Done.
2. ~~Model fingerprint, then the EPA release watcher.~~ Done, with weekly CI validation.
3. The one-command update path.
4. Point source, including the aggregate sheets.
5. `All Sources Output`, once there are two paths to aggregate.
6. Area soil and area water.

No dates. The sequence is the commitment.
