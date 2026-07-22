# Collection import — Kinet.ink → DD69 Divi Collectibles

How a collection authored in **Kinet.ink** (art, traits, rarity tiers) is exported
and re-assembled in the **DD69 NFD Builder** to be finalized and published on Divi.

The import feeds the existing builder flow: create the collection record, then mint
each item into it (encrypt the original, upload, publish the public preview +
traits, anchor on-chain). It naturally also gives us **batch mint** for the 240-set.

---

## The bundle

Kinet.ink exports a **folder** containing one `manifest.json` plus the image files
it references (a zip is fine — Geoff unzips, then points DD69 at the folder). DD69
reads everything locally: **no URLs, no network fetch of images** (keeps us off the
"never take image URLs" rule and off SSRF/untrusted-fetch risk).

```
divi-genesis/
  manifest.json
  cover.webp                (optional collection banner)
  originals/1.png ... 240.png     (full-res; encrypted, owner-only)
  previews/1.webp ... 240.webp    (optional public previews; see §choice 2)
```

## manifest.json

```json
{
  "format": "divi-collectibles-import",
  "version": 1,
  "collection": {
    "name": "Divi Genesis",
    "description": "The first Divi Collectibles drop.",
    "maxSupply": 240,
    "cover": "cover.webp"
  },
  "items": [
    {
      "edition": 1,
      "name": "Divi Genesis #1",
      "tier": "Legendary",
      "original": "originals/1.png",
      "preview": "previews/1.webp",
      "attributes": [
        { "trait_type": "Background", "value": "Nebula" },
        { "trait_type": "Aura", "value": "Gold" }
      ]
    }
  ]
}
```

Field notes:
- `tier` + `attributes` map straight to the **locked traits schema** (`{ name,
  edition, tier, attributes }`). `edition` is the 1-based index; it must be unique
  and should run 1..maxSupply.
- `original` = the full-quality art; DD69 encrypts it to the owner (never public).
- `preview` = the public thumbnail (what the marketplace shows). Optional — see
  choice 2.
- `cover` = optional public collection banner.

## What DD69 does on import

1. Pick the folder → parse + **validate** the manifest (schema, editions unique and
   within `maxSupply`, every referenced file exists, image files are real images).
2. Show a **summary before anything is published**: N items, tier breakdown, which
   files, total size, whether it will use permanent (relay) or local storage.
3. On confirm: create the collection, then mint each item in order. **Resumable** —
   a 240-item run will fail partway at some point; it records which editions
   succeeded and resumes rather than restarting (no double-mints).
4. Progress + a final report (minted / skipped / failed).

## Validation / safety
- Manifest size cap; item count cap; per-field length caps (names, trait strings).
- Reject path traversal in file references (must stay inside the chosen folder).
- Confirm each `original`/`preview` is a decodable image of an allowed type before
  minting; skip + report anything that isn't.
- Public previews are the moderated surface — the same relay-side scanning in
  `NFD-MODERATION.md` applies when using permanent storage.

## Open choices (being confirmed with Geoff)
1. **Delivery:** folder-with-manifest (recommended) vs single zip vs one JSON with
   base64-embedded images.
2. **Previews:** does Kinet.ink export a public preview per item, or export only
   originals and let DD69 auto-generate the ≤500px WebP preview?
