#!/bin/sh
# Scan for the DPRK "5-3-316" payload family. WARNS ONLY; changes nothing.
#
# WHY THIS EXISTS BESIDE THE HOOK. ~/.git-templates/hooks/git-sanitize-malware
# is auto-REMEDIATION for the exact known payload and is deliberately narrow in
# two ways that are invisible from outside, because a file it never opened is
# as silent as a file it cleared:
#
#   1. it matches only files carrying ALL THREE signatures together
#      (windowsHide:true AND _$_ AND 5-3-316), so a variant with two of them,
#      or the same technique under a different tag, passes
#   2. it looks only at TRACKED *.js *.mjs *.cjs *.ts *.tsx
#
# Measured against one real day's work (93 files changed): the hook would
# examine 38 and ignore 55. Forty-seven of the ignored were THESE VERY SCRIPTS.
#
# ⚠ AND THAT IS THE INVERSION WORTH UNDERSTANDING. The hook covers the
# extensions that need a BUILD STEP to reach execution and misses the one class
# that IS execution: a .ts payload waits for a bundler, a .sh payload in a test
# runner waits for the next time somebody types `sh scripts/run-...`, which is
# continuously. The coverage reads the opposite way round to the risk.
#
# So this checks EVERY extension, each signature INDEPENDENTLY, and reports
# rather than edits. Widening detection is safe; widening the hook's auto-strip
# would turn a false positive into a silent modification of real source, and
# that remains Geoff's call and nobody else's.
#
# BASELINE ON A CLEAN TREE: 8 hits over 816 tracked files (2026-Sep-28).
# A NINTH IS THE SIGNAL. Written here rather than left in a chat message,
# because a baseline nobody can look up is a baseline nobody checks against,
# and "is 8 normal?" is the question that decides whether a hit gets read.
#
#   4x hex-decode  atob on base64 of real binary data:
#                  rebelsAudio.ts, starCatalog.ts, pinCrypto.ts (b64url),
#                  CollectiblesPanel.tsx (collectible import)
#   2x eval + hex-decode  contrib/app-builder/test/gate.test.mjs - the OPPOSITE
#                  of a problem: fixtures asserting the app builder's own gate
#                  REFUSES eval, new Function and atob
#   2x windowsHide + spawn  THIS FILE, matching its own probe strings
#
# The self-match is deliberate and is NOT exempted. A scanner that skips itself
# is a scanner nobody scans, and the file most worth protecting is the one
# whose silence everybody trusts. Two permanent, explained hits are a cheaper
# price than a blind spot in the tool.
#
# ⚠ EDITING THIS HEADER CAN CHANGE THE BASELINE. The comments are scanned like
# any other line, so writing a probe pattern in prose adds a hit: documenting
# the baseline took it from 8 to 9 until the brackets came off "atob".
# Keep examples bracket-free. This is the self-match being honest, not a bug.
#
# There is deliberately NO allowlist. An allowlist goes stale silently and then
# suppresses the thing it was added to surface, which is the failure this whole
# file exists to avoid. Read the hits; a hit is evidence, not a verdict.
#
# Usage:
#   sh scripts/scan-payload.sh                  # everything changed vs origin/HEAD
#   sh scripts/scan-payload.sh <ref>            # everything changed since <ref>
#   sh scripts/scan-payload.sh --all            # every tracked file
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

case "${1:-}" in
  --all) FILES=$(git ls-files) ;;
  "")    BASE=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo HEAD)
         FILES=$(git diff --name-only "$BASE" 2>/dev/null; git diff --name-only; git ls-files -o --exclude-standard) ;;
  *)     FILES=$(git diff --name-only "$1") ;;
esac

# Untracked files are included above on purpose: the hook cannot see them and a
# payload does not need to be committed to be run.
FILES=$(printf '%s\n' "$FILES" | grep -v '^$' | grep -v node_modules | sort -u)
[ -z "$FILES" ] && { echo "nothing to scan"; exit 0; }

n=0; bad=0
for f in $FILES; do
  [ -f "$f" ] || continue
  n=$((n + 1))
  for probe in \
    'campaign-tag:global[^=]*=[^=]*['"'"'"][0-9]\{1,\}-[0-9]\{1,\}-[0-9]\{1,\}['"'"'"]' \
    'decoder:_\$_[0-9a-fA-F]\{4,\}' \
    'windowsHide:windowsHide' \
    'spawn:child_process\|spawnSync\?[[:space:]]*(' \
    'eval:\beval[[:space:]]*(\|new[[:space:]]\+Function[[:space:]]*(' \
    'space-padding:[[:space:]]\{80,\}[^[:space:]]' \
    'hex-decode:atob[[:space:]]*(\|Buffer\.from([^)]*['"'"'"]hex['"'"'"]'
  do
    label=${probe%%:*}; rx=${probe#*:}
    if grep -n "$rx" "$f" >/dev/null 2>&1; then
      echo "⚠ $label  $f"
      grep -n "$rx" "$f" 2>/dev/null | head -3 | sed 's/^/      /' | cut -c1-160
      bad=$((bad + 1))
    fi
  done
done

echo ""
if [ "$bad" -eq 0 ]; then
  echo "CLEAN: $n files, no payload signature found"
else
  echo "⚠ $bad signature hit(s) across $n files. READ THEM; do not auto-strip."
  echo "  A hit is not a verdict: eval and child_process are legitimate in places."
  exit 1
fi
