# Tests

    ./run_all.sh            # everything (~2.5 min)
    ./run_all.sh --fast     # skip the 672-file data sweep (~15 s)

Fetch the EPA files first. They are not redistributed here: EPA's licence
restricts redistribution of the workbook, and the run files are 331 MB.

    python3 fetch_fixtures.py           # ~331 MB, cached after the first run
    python3 fetch_fixtures.py --full    # also keep the full 672-file zip

That downloads EPA's distribution, builds `fixtures/` from it, and checks every
file against `fixtures.sha256`. A file that does not match EPA's own bytes is a
hard error, so the headline result, the engine agreeing with an independent
oracle to 5.7e-08, is reproducible against EPA's copy rather than against one
this repository vouches for.

The 672-file sweep in `test_data.py` needs the complete run files, which only
`--full` keeps. Without them that suite skips and says so; the other two run.

## Source files and how to point at them

Both inputs are overridable, so you can run against copies you already have
without fetching anything:

| Variable | Default | Used by |
|---|---|---|
| `IIOAC_WORKBOOK` | `tests/fixtures/iioac_1.0.xlsm` | `workbook.py`, all fidelity assertions |
| `IIOAC_RUNFILES` | `tests/fixtures/runfiles.zip` | `oracle.py`, and the full sweep |
| `IIOAC_DIST` | `tests/fixtures/iioac_1.0.zip` | `fetch_fixtures.py`, skips the download |

    # verify against your own copies
    IIOAC_WORKBOOK=~/Documents/iioac/iioac_1.0.xlsm \
    IIOAC_RUNFILES=~/Documents/iioac/IIOAC_RunFiles.zip ./run_all.sh

Both files come from EPA's IIOAC distribution:
<https://www.epa.gov/sites/default/files/2019-06/iioac_1.0.zip>, a single zip
containing `IIOAC 1.0.xlsm` and `IIOAC_RunFiles.zip`.

## Suites

**`test_units.mjs`** (45 assertions) — pure helpers and engine guards. Number and CSV
formatting, scaling-factor edge cases, rejected inputs, and model invariants
(High-End >= Mean >= Low-End, fenceline > outer-boundary, linearity in release amount,
scenario additivity, cap clamping, vapor left uncapped).

**`test_engine.py`** (19 assertions) — the fidelity suite. Runs `engine.js` and an
independent oracle over the same cases and compares all 23 output values across the six
rows the workbook reports.

**`test_data.py`** (10 assertions) — verifies every one of the 672 `.bin` files against
the `.xlsx` it came from, plus a cell-for-cell check of 12 sampled files (1.05M values)
read back through openpyxl.

## Why the oracle is independent

`workbook.py` does not restate the model. It parses `iioac_1.0.xlsm` and recovers:

- the row -> (column offset, receptor band) map, from the `INDEX(...)` ranges in
  `Fugitive Calculations Prelim` column E
- the `0.2778` emission constant, from the same formula text
- which calculation row feeds each output row, from the `SUM(...)` ranges in
  `Fugitive Output Prelim`
- the indoor/outdoor ratio cell each output row points at (`lookups!B57` / `B58`)
- the dose multipliers and divisors, from the dose formula strings
- receptor body weights and inhalation rates, evaluating the formula cells in
  `lookups!A25:F32`

`oracle.py` then reads unit values from the original AERMOD `.xlsx` inside
`IIOAC_RunFiles.zip` through openpyxl. So an oracle run shares no code and no data file
with the web app: different formula source, different reader, different storage format.

## Tolerance

The engine agrees with the oracle to a worst relative error of **5.7e-08**. That is the
float32 storage limit of the `.bin` files, not model drift — the same figure appears when
openpyxl reads the source `.xlsx` directly in `test_data.py`. Both suites fail at 1e-6.

## Regenerating inputs

`data/lookups.json` is generated, not hand-written:

    python3 ../tools/build_lookups.py

The `.bin` run files are generated too, by `../tools/convert.py`. It reads the same
`IIOAC_RUNFILES` zip and writes to `../data`:

    IIOAC_RUNFILES=~/Documents/iioac/IIOAC_RunFiles.zip python3 ../tools/convert.py

`test_data.py` re-runs that conversion over all 672 files and asserts the result is
byte-identical to what is committed, so the shipped data is reproducible from EPA's
originals rather than being a one-off dump.

`test_engine.py` asserts the generated file still matches the workbook exactly, which is
how a hand-transcription defect in four scaling exponents was caught.
