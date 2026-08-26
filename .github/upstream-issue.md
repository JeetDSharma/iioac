The weekly check found EPA's IIOAC download no longer matches the baseline in
`data/epa-version.json`. The live site now discloses that it may be stale.

Next steps, per [ROADMAP.md](../blob/main/ROADMAP.md):

- [ ] `python3 tests/fetch_fixtures.py` — expect a checksum mismatch, confirming what changed
- [ ] Regenerate the model fingerprint and diff it, to see which formulas EPA moved
- [ ] Re-convert the run files with `tools/convert.py`
- [ ] Re-run the oracle suite against the new workbook
- [ ] Publish alongside the old version, never over it
- [ ] Update `portedEpaVersion` and the checksum baseline once validated

Nothing is auto-published. This issue is the gate.
