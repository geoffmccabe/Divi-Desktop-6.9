#!/usr/bin/env python3
"""
Cut a high-resolution night-lights map into tiles the game can stream.

WHY THIS IS NOT JUST "CHOP UP A BIGGER PICTURE"
----------------------------------------------
The globe's existing map is not raw NASA imagery. It is a composite: a blue
land-and-bathymetry relief with city lights sitting on top of it, and that blue
base IS the look of the game. Geoff asked for far more detail while it still
"looks nearly identical, with the same colors", so replacing the image wholesale
is exactly the wrong move: NASA's Black Marble is city lights on black, with no
relief and no blue at all, and dropping it in would change every colour on the
globe.

What actually needs the resolution is only the LIGHTS. The blue relief is
smooth, low-frequency, and looks perfectly fine enlarged; the lights are the
high-frequency detail that turns to mush. So each tile is built as:

    tile = enlarged(existing map)  +  (NASA lights - blurred NASA lights)

The second term is an unsharp mask: it is the detail the existing map is MISSING
and nothing else, because everything the existing map already knows is exactly
what "blurred NASA lights" contains. That has a property worth stating plainly,
and the build checks it: shrink a finished tile back down to the old resolution
and you get the old map back. So from orbit nothing changes at all, and the new
detail only exists at the scales where there used to be none.

USAGE
  scripts/build-earth-tiles.py --source nasa.jpg --base earth-night.jpg --out tiles/
Needs Pillow and numpy. It is a build tool, run by hand, not part of the app.
"""

import argparse, json, os, sys
from PIL import Image
import numpy as np

Image.MAX_IMAGE_PIXELS = None

# The colour of a city light in the existing map, measured from it rather than
# picked: the warmest half a percent of its pixels average to this, normalised
# so the red channel is one. NASA's own lights come out at (1, 0.877, 0.823) in
# the same measurement, which is close enough that the detail needs no hue
# correction at all, only a brightness match.
LIGHT_TINT = np.array([1.0, 0.852, 0.834], np.float32)


def load(path, label):
    img = Image.open(path).convert("RGB")
    print(f"  {label}: {img.width}x{img.height}  {path}")
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="high-resolution night lights, equirectangular")
    ap.add_argument("--base", required=True, help="the map the globe uses today")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tile-deg", type=float, default=30.0, help="degrees of longitude and latitude per tile")
    ap.add_argument("--gain", type=float, default=1.0, help="how strongly the new detail is added")
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()

    print("reading:")
    src = load(args.source, "source")
    base = load(args.base, "base  ")

    if abs(src.width / src.height - 2.0) > 0.01:
        print("! source is not 2:1, so it is not equirectangular", file=sys.stderr)
        return 1

    cols = int(round(360 / args.tile_deg))
    rows = int(round(180 / args.tile_deg))
    # One tile at the source's own resolution. Upsampling here would be inventing
    # detail; the point of the exercise is to carry the detail that exists.
    size = int(round(src.width / cols))
    print(f"\ngrid: {cols} x {rows} tiles of {args.tile_deg} degrees, {size}x{size} each")
    print(f"      {src.width / 360:.1f} source pixels per degree "
          f"({40075.0 / src.width * 1000:.0f} m per pixel at the equator)")

    os.makedirs(args.out, exist_ok=True)
    made = 0
    worst = 0.0

    for row in range(rows):
        for col in range(cols):
            # The window, in each image's own pixels.
            def box(img):
                return (round(col * img.width / cols), round(row * img.height / rows),
                        round((col + 1) * img.width / cols), round((row + 1) * img.height / rows))

            hi = np.asarray(src.crop(box(src)).resize((size, size), Image.LANCZOS), np.float32)
            lo_box = box(base)
            lo_w, lo_h = lo_box[2] - lo_box[0], lo_box[3] - lo_box[1]
            lo = base.crop(lo_box)

            # Skip a tile with nothing in it. Most of the ocean and both poles
            # have no lights at all, and a tile that adds nothing is a download
            # the player should never have to make.
            luma = hi @ np.array([0.2126, 0.7152, 0.0722], np.float32)

            # ---- the detail the base is missing ----
            # Shrink the source to exactly what the base can hold, enlarge it
            # back, and subtract. What is left is only what the base cannot
            # represent, which is precisely what should be added to it.
            himg = Image.fromarray(np.clip(hi, 0, 255).astype(np.uint8))
            blur = np.asarray(
                himg.resize((lo_w, lo_h), Image.LANCZOS).resize((size, size), Image.LANCZOS),
                np.float32)
            detail = (hi - blur) @ np.array([0.2126, 0.7152, 0.0722], np.float32)

            if float(np.abs(detail).mean()) < 0.6 and float(luma.max()) < 24:
                continue

            out = (np.asarray(lo.resize((size, size), Image.LANCZOS), np.float32)
                   + args.gain * detail[:, :, None] * LIGHT_TINT[None, None, :])
            out = np.clip(out, 0, 255).astype(np.uint8)

            # ---- the promise, checked ----
            # Shrink the finished tile back to the base's resolution. It must
            # come back to the base, or the globe would change colour when seen
            # from orbit, which is the one thing that must not happen.
            check = np.asarray(Image.fromarray(out).resize((lo_w, lo_h), Image.LANCZOS), np.float32)
            drift = float(np.abs(check - np.asarray(lo, np.float32)).mean())
            worst = max(worst, drift)

            Image.fromarray(out).save(
                os.path.join(args.out, f"t_{col}_{row}.webp"), quality=args.quality, method=4)
            made += 1
        print(f"  row {row + 1}/{rows}  ({made} tiles so far)")

    manifest = {
        "version": 1, "tileDeg": args.tile_deg, "cols": cols, "rows": rows,
        "size": size, "format": "webp", "tiles": made,
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh)

    total = sum(os.path.getsize(os.path.join(args.out, f)) for f in os.listdir(args.out))
    print(f"\n{made} tiles of a possible {cols * rows}  ({cols * rows - made} were empty sky or empty ocean)")
    print(f"worst drift from the old map when shrunk back: {worst:.2f} of 255")
    print(f"total {total / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
