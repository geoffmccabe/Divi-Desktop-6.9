#!/usr/bin/env python3
"""Bump the app version, everywhere it appears.

    python3 scripts/bump-version.py patch    # a fix or a change   69.2.0 -> 69.2.1
    python3 scripts/bump-version.py feature  # something new       69.2.1 -> 69.3.0

Geoff's rule: every version gets the last digit; a new feature gets the second.

The version lives in crates/app/tauri.conf.json and NOWHERE ELSE. The window
title and the product name are derived from it here, and the sidebar reads it at
build time, so the number on screen can never disagree with the number that
shipped. That has happened: the window title sat at "69.01" while the app said
69.0.3.

Run this before building, not after, or the build carries the old number.
"""
import json
import sys

CONF = "crates/app/tauri.conf.json"


def bump(version: str, kind: str) -> str:
    major, minor, patch = (int(p) for p in version.split("."))
    if kind == "feature":
        return f"{major}.{minor + 1}.0"
    if kind == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit(f'unknown bump "{kind}" — use "patch" or "feature"')


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)

    with open(CONF) as f:
        conf = json.load(f)

    was = conf["version"]
    now = bump(was, sys.argv[1]) if sys.argv[1] in ("patch", "feature") else sys.argv[1]

    conf["version"] = now
    # Both of these are shown to people, and both have drifted before.
    conf["productName"] = f"Divi Desktop {now}"
    conf["app"]["windows"][0]["title"] = f"Divi Desktop {now}"

    with open(CONF, "w") as f:
        json.dump(conf, f, indent=2)
        f.write("\n")

    print(f"{was} -> {now}")
    print("  version, productName and the window title are all updated.")
    print("  The sidebar reads it at build time, so nothing else to change.")


if __name__ == "__main__":
    main()
