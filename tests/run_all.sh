#!/bin/sh
# Run every suite. Pass --fast to skip the 672-file data sweep (~2 min).
cd "$(dirname "$0")" || exit 1
status=0

echo "=== unit tests (JS) ==============================================="
node test_units.mjs || status=1

echo
echo "=== engine vs workbook oracle ====================================="
python3 test_engine.py 2>/dev/null || status=1

if [ "$1" != "--fast" ]; then
  echo
  echo "=== data integrity (672 run files) ================================"
  python3 test_data.py 2>/dev/null || status=1
fi

echo
[ $status -eq 0 ] && echo "ALL SUITES PASSED" || echo "FAILURES — see above"
exit $status
