# Tests

    ./run_all.sh            # everything (~2.5 min)
    ./run_all.sh --fast     # skip the 672-file data sweep (~15 s)

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

`test_engine.py` asserts the generated file still matches the workbook exactly, which is
how a hand-transcription defect in four scaling exponents was caught.
