#!/bin/sh
# Publish a checksum beside the Divi chain snapshot.
#
# RUN THIS ON THE SNAPSHOT SERVER, as the last step of whatever job builds
# DIVI-snapshot.tar.gz. Nothing else needs to change: DD69 already looks for
# DIVI-snapshot.tar.gz.sha256 on every download and starts verifying the moment
# it appears.
#
# WHY IT MATTERS EVEN THOUGH WE MAKE THE SNAPSHOT OURSELVES. This is not about
# trusting Divi. A five-gigabyte transfer over an ordinary home connection can
# truncate or corrupt, a proxy or captive portal can substitute a page, and a
# CDN can serve a half-written file. Any of those produce a chain that looks
# fine and then misbehaves in ways nobody can trace back to the download. The
# checksum turns all of that into one clear refusal at the moment it happens.
#
# ORDER MATTERS. The checksum is written to a temporary name and moved into
# place only once it is complete, and only AFTER the archive itself is final.
# Publishing a checksum beside a half-written archive is worse than none: every
# download would fail verification and nobody would know why.
#
# Usage:
#   sh publish-snapshot-checksum.sh /var/www/snapshots/dist/DIVI-snapshot.tar.gz
set -eu

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  echo "usage: $0 /path/to/DIVI-snapshot.tar.gz" >&2
  exit 2
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "no such archive: $ARCHIVE" >&2
  exit 1
fi

# Refuse to checksum something that is still being written. If the size changes
# across a short pause, the build is not finished.
SIZE_A=$(wc -c < "$ARCHIVE")
sleep 5
SIZE_B=$(wc -c < "$ARCHIVE")
if [ "$SIZE_A" != "$SIZE_B" ]; then
  echo "the archive is still being written ($SIZE_A -> $SIZE_B bytes); not publishing a checksum" >&2
  exit 1
fi

# Sanity: a real gzip starts with 1f 8b. Catches a failed build that left an
# error message or an empty file behind.
MAGIC=$(od -An -tx1 -N2 "$ARCHIVE" | tr -d ' \n')
if [ "$MAGIC" != "1f8b" ]; then
  echo "that is not a gzip archive (starts with $MAGIC); not publishing a checksum" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  SUM=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
else
  SUM=$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)
fi

OUT="$ARCHIVE.sha256"
TMP="$OUT.tmp.$$"
printf '%s  %s\n' "$SUM" "$(basename "$ARCHIVE")" > "$TMP"
chmod 644 "$TMP"
mv -f "$TMP" "$OUT"   # atomic: readers see the old one or the new one, never half

echo "published $OUT"
echo "  $SUM"
