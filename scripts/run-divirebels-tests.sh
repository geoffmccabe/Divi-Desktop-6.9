#!/bin/sh
# Run the Divi Rebels self test against the file that actually ships.
#
# Splices crates/app/src/community/divirebels/selftest.js onto a copy of that
# folder's index.html, loads it in headless Chrome, and prints the results.
# Nothing is installed and nothing is built: this reads two files and renders
# them, which is why it is safe to run at any time.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GAME="$ROOT/crates/app/src/community/divirebels"
OUT="${TMPDIR:-/tmp}/divirebels-selftest.html"
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

python3 - "$GAME" "$OUT" <<'PY'
import sys
game, out = sys.argv[1], sys.argv[2]
html = open(game + "/index.html").read()
tests = open(game + "/selftest.js").read()
block = '<div id="result"></div>\n<script>\n' + tests + '\n</script>'
open(out, "w").write(html.replace("</body>", block + "\n</body>", 1))
PY

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=40000 --dump-dom "file://$OUT" 2>/dev/null | python3 -c "
import sys, re
d = sys.stdin.read()
m = re.search(r'id=\"result\">(.*?)</div>', d, re.S)
if not m:
    print('NO RESULT: the page did not run'); sys.exit(1)
rows = [r.strip() for r in m.group(1).split(' || ')]
print('\n'.join(rows))
bad = sum(1 for r in rows if r.startswith('FAIL'))
print()
print(sum(1 for r in rows if r.startswith('PASS')), 'passed,', bad, 'failed')
sys.exit(1 if bad else 0)
"
