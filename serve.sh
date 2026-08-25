#!/bin/sh
# Serve the calculator locally. The run-file data is too large to inline,
# so the page needs to be served over HTTP rather than opened as a file://.
cd "$(dirname "$0")" && exec python3 -m http.server "${1:-8765}"
