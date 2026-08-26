#!/bin/sh
# Run every suite. Pass --fast to skip the 672-file data sweep (~2 min).
cd "$(dirname "$0")" || exit 1
status=0

# openpyxl is chatty about the workbook's VBA and styles, so stderr is hidden on
# success. On failure it is printed: a suite that dies silently is unreadable in
# CI, which is exactly where nobody can rerun it by hand.
run_py() {
  err=$(mktemp)
  if python3 "$1" 2>"$err"; then
    :
  else
    status=1
    [ -s "$err" ] && sed 's/^/  /' "$err"
  fi
  rm -f "$err"
}

echo "=== model fingerprint (28 sheets) ================================="
run_py fingerprint.py

echo
echo "=== unit tests (JS) ==============================================="
node test_units.mjs || status=1

echo
echo "=== engine vs workbook oracle ====================================="
run_py test_engine.py

if [ "$1" != "--fast" ]; then
  echo
  echo "=== data integrity (672 run files) ================================"
  run_py test_data.py
fi

echo
[ $status -eq 0 ] && echo "ALL SUITES PASSED" || echo "FAILURES — see above"
exit $status
