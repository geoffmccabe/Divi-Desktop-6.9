#!/usr/bin/env bash
# Sync the vendored protocol crates from the chain repo.
#
# `crates/dvxp-core` and `crates/name-registry` are BYTE-IDENTICAL copies of
# contrib/dvxp-core and contrib/name-registry in geoffmccabe/Divi-Blockchain_6.9,
# which is where they are normative. They are vendored rather than referenced so
# that DD69 builds standalone, with no private-repo credentials and no network.
#
# The rules in those crates must give identical answers in the wallet, the
# explorer and every indexer. A silent drift between two copies is exactly the
# failure the whole design exists to avoid, so this script exists to make drift
# loud.
#
#   ./scripts/sync-divi-crates.sh          check for drift (exit 1 if any)
#   ./scripts/sync-divi-crates.sh --apply  copy the chain repo's version in
#
# CHAIN_REPO overrides where the chain repo lives.

set -euo pipefail

CHAIN_REPO="${CHAIN_REPO:-$HOME/Divi-Blockchain_6.9}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATES=(dvxp-core name-registry)
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ ! -d "$CHAIN_REPO/contrib" ]; then
  echo "Chain repo not found at $CHAIN_REPO."
  echo "Set CHAIN_REPO=/path/to/Divi-Blockchain_6.9 if it lives elsewhere."
  echo "Skipping: the vendored copies are self-contained, so this is not a build error."
  exit 0
fi

drift=0
for c in "${CRATES[@]}"; do
  src="$CHAIN_REPO/contrib/$c"
  dst="$HERE/crates/$c"
  if [ "$APPLY" = "1" ]; then
    rm -rf "$dst/src"
    cp -R "$src/src" "$dst/src"
    cp "$src/Cargo.toml" "$dst/Cargo.toml"
    echo "synced $c"
  else
    if ! diff -ru "$src/src" "$dst/src" >/dev/null 2>&1 \
       || ! diff -u "$src/Cargo.toml" "$dst/Cargo.toml" >/dev/null 2>&1; then
      echo "DRIFT in $c:"
      diff -ru "$src/src" "$dst/src" || true
      diff -u "$src/Cargo.toml" "$dst/Cargo.toml" || true
      drift=1
    else
      echo "ok $c"
    fi
  fi
done

if [ "$drift" = "1" ]; then
  echo
  echo "The vendored crates differ from the chain repo. Decide which side is right,"
  echo "then re-run with --apply (chain repo wins) or push your change to the chain repo."
  exit 1
fi
