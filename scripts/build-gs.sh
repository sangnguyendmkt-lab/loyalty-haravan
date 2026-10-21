#!/bin/sh
# Concatenate src/*.js into one file to paste into the Apps Script editor (Code.gs).
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
{
  echo "// Loyalty Haravan — generated from src/ by scripts/build-gs.sh. Do not edit here."
  for f in rules sheets haravan batch menu; do
    [ -f "src/$f.js" ] && { echo; echo "// ===== $f.js ====="; cat "src/$f.js"; }
  done
} > dist/Loyalty.gs
node --check dist/Loyalty.gs 2>/dev/null || node -e "new Function(require('fs').readFileSync('dist/Loyalty.gs','utf8'))"
echo "dist/Loyalty.gs: $(wc -l < dist/Loyalty.gs) lines"
