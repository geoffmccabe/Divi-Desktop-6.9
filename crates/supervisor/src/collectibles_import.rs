// Collection import: unpack a Kinet.ink .zip bundle (manifest.json + images) and
// hand items to the existing mint flow. See docs/NFD-COLLECTION-IMPORT.md.
//
// The manifest and every path in it are UNTRUSTED. Defenses here: zip-slip
// rejection on extract, path-escape rejection when resolving referenced files,
// per-file + total size caps (zip-bomb), entry-count cap, and magic-byte image
// validation. Nothing is published by this module — it only unpacks, validates,
// and reads bytes; the caller drives create-collection + mint.

use crate::config::NodeConfig;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const MAX_ITEMS: usize = 10_000;
const MAX_ZIP_ENTRIES: usize = 60_000;
const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024; // per extracted file
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024; // whole bundle
const MAX_IMAGE_BYTES: usize = 60 * 1024 * 1024; // per original/preview read
const STR_MAX: usize = 512;
const ATTRS_MAX: usize = 64;

fn sanitize_stem(name: &str) -> String {
    let stem: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    if stem.is_empty() { "import".to_string() } else { stem.chars().take(64).collect() }
}

/// Join `rel` under `base`, rejecting absolute paths and any `..`/root escape.
/// The manifest author is untrusted, so a referenced path must stay inside.
fn resolve_within(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rp = Path::new(rel);
    let mut out = base.to_path_buf();
    for comp in rp.components() {
        match comp {
            Component::Normal(c) => out.push(c),
            _ => return Err(format!("unsafe path in manifest: {rel}")),
        }
    }
    Ok(out)
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 4 && &bytes[..4] == b"\x89PNG" {
        Some("image/png")
    } else if bytes.len() >= 3 && &bytes[..3] == b"\xFF\xD8\xFF" {
        Some("image/jpeg")
    } else if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn cap_str(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").chars().take(STR_MAX).collect()
}

fn import_root(cfg: &NodeConfig, stem: &str) -> PathBuf {
    cfg.datadir.join("nfd-import").join(stem)
}

/// Unpack the zip into a clean per-bundle dir under the datadir. Returns the dir.
fn unpack(cfg: &NodeConfig, zip_path: &str) -> Result<PathBuf, String> {
    let f = fs::File::open(zip_path).map_err(|e| format!("cannot open zip: {e}"))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("not a valid zip: {e}"))?;
    if zip.len() > MAX_ZIP_ENTRIES {
        return Err("zip has too many entries".into());
    }
    let stem = sanitize_stem(Path::new(zip_path).file_stem().and_then(|s| s.to_str()).unwrap_or("import"));
    let dir = import_root(cfg, &stem);
    let _ = fs::remove_dir_all(&dir); // fresh extract each open (idempotent for resume)
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create import dir: {e}"))?;

    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("corrupt zip entry: {e}"))?;
        // enclosed_name() is None for any path that would escape (zip-slip safe).
        let rel = match entry.enclosed_name() {
            Some(p) => p,
            None => continue, // skip unsafe entries silently
        };
        let out = dir.join(&rel);
        if entry.is_dir() {
            let _ = fs::create_dir_all(&out);
            continue;
        }
        if entry.size() > MAX_FILE_BYTES {
            return Err("a file in the zip is too large".into());
        }
        total = total.saturating_add(entry.size());
        if total > MAX_TOTAL_BYTES {
            return Err("the zip bundle is too large".into());
        }
        if let Some(parent) = out.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut buf = Vec::new();
        entry.by_ref().take(MAX_FILE_BYTES).read_to_end(&mut buf).map_err(|e| format!("read failed: {e}"))?;
        fs::write(&out, &buf).map_err(|e| format!("write failed: {e}"))?;
    }
    Ok(dir)
}

fn read_manifest(dir: &Path) -> Result<Value, String> {
    let path = dir.join("manifest.json");
    let meta = fs::metadata(&path).map_err(|_| "manifest.json not found in the bundle".to_string())?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err("manifest.json is too large".into());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("cannot read manifest: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("manifest is not valid JSON: {e}"))?;
    if v.get("format").and_then(|x| x.as_str()) != Some("divi-collectibles-import") {
        return Err("not a Divi Collectibles import bundle".into());
    }
    if v.get("version").and_then(|x| x.as_i64()) != Some(1) {
        return Err("unsupported import version".into());
    }
    Ok(v)
}

/// Open + validate a bundle. Returns a plan the UI shows BEFORE anything is
/// published: collection meta (+ cover bytes), and a per-item summary with ok/error.
pub fn open(cfg: &NodeConfig, zip_path: &str) -> Result<Value, String> {
    let dir = unpack(cfg, zip_path)?;
    let m = read_manifest(&dir)?;

    let col = m.get("collection").ok_or("manifest has no collection")?;
    let name = cap_str(col, "name");
    if name.is_empty() {
        return Err("collection name is required".into());
    }
    let description = cap_str(col, "description");
    let max_supply = col.get("maxSupply").and_then(|x| x.as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32;
    // Content mode: default Encrypted; a Perc/public set sets "encrypted": false.
    let encrypted = col.get("encrypted").and_then(|x| x.as_bool()).unwrap_or(true);

    // Optional cover, inlined (one small image) so the UI can create the collection.
    let (mut cover_b64, mut cover_mime) = (Value::Null, Value::Null);
    if let Some(cover_rel) = col.get("cover").and_then(|x| x.as_str()) {
        if let Ok(p) = resolve_within(&dir, cover_rel) {
            if let Ok(bytes) = fs::read(&p) {
                if bytes.len() <= MAX_IMAGE_BYTES {
                    if let Some(mime) = image_mime(&bytes) {
                        cover_b64 = json!(STANDARD.encode(&bytes));
                        cover_mime = json!(mime);
                    }
                }
            }
        }
    }

    let items = m.get("items").and_then(|x| x.as_array()).ok_or("manifest has no items")?;
    if items.is_empty() {
        return Err("the bundle has no items".into());
    }
    if items.len() > MAX_ITEMS {
        return Err("the bundle has too many items".into());
    }

    let mut seen = std::collections::HashSet::new();
    let mut out_items = Vec::with_capacity(items.len());
    let mut warnings = Vec::new();
    for it in items {
        let edition = it.get("edition").and_then(|x| x.as_u64());
        let iname = cap_str(it, "name");
        let tier = it.get("tier").and_then(|x| x.as_str()).map(|s| s.chars().take(STR_MAX).collect::<String>());
        let mut err: Option<String> = None;

        match edition {
            None => err = Some("missing edition".into()),
            Some(e) => {
                if !seen.insert(e) {
                    err = Some(format!("duplicate edition {e}"));
                } else if max_supply > 0 && (e < 1 || e > max_supply as u64) {
                    err = Some(format!("edition {e} out of range 1..{max_supply}"));
                }
            }
        }
        // Validate the original exists + is an image.
        let has_preview = it.get("preview").and_then(|x| x.as_str()).map_or(false, |rel| {
            resolve_within(&dir, rel).ok().and_then(|p| fs::metadata(&p).ok()).is_some()
        });
        if err.is_none() {
            match it.get("original").and_then(|x| x.as_str()) {
                None => err = Some("missing original image".into()),
                Some(rel) => match resolve_within(&dir, rel).and_then(|p| fs::read(&p).map_err(|e| e.to_string())) {
                    Err(_) => err = Some(format!("original not found: {rel}")),
                    Ok(bytes) => {
                        if image_mime(&bytes).is_none() {
                            err = Some(format!("original is not a supported image: {rel}"));
                        }
                    }
                },
            }
        }
        if let Some(e) = &err {
            warnings.push(json!({ "edition": edition, "error": e }));
        }
        out_items.push(json!({
            "edition": edition, "name": iname, "tier": tier,
            "hasPreview": has_preview, "ok": err.is_none(), "error": err,
        }));
    }

    let ok_count = out_items.iter().filter(|i| i["ok"].as_bool().unwrap_or(false)).count();
    Ok(json!({
        "importDir": dir.to_string_lossy(),
        "collection": {
            "name": name, "description": description, "maxSupply": max_supply,
            "coverB64": cover_b64, "coverMime": cover_mime, "encrypted": encrypted,
        },
        "items": out_items,
        "okCount": ok_count,
        "warnings": warnings,
    }))
}

/// Read ONE item's bytes + metadata for minting. `import_dir` must be one this
/// process produced under the datadir (re-checked here), never an arbitrary path.
pub fn read_item(cfg: &NodeConfig, import_dir: &str, edition: u64) -> Result<Value, String> {
    let dir = PathBuf::from(import_dir);
    let root = cfg.datadir.join("nfd-import");
    if !dir.starts_with(&root) {
        return Err("invalid import directory".into());
    }
    let m = read_manifest(&dir)?;
    let items = m.get("items").and_then(|x| x.as_array()).ok_or("no items")?;
    let it = items
        .iter()
        .find(|it| it.get("edition").and_then(|x| x.as_u64()) == Some(edition))
        .ok_or_else(|| format!("edition {edition} not in bundle"))?;

    let orig_rel = it.get("original").and_then(|x| x.as_str()).ok_or("item has no original")?;
    let orig = fs::read(resolve_within(&dir, orig_rel)?).map_err(|e| format!("cannot read original: {e}"))?;
    if orig.len() > MAX_IMAGE_BYTES {
        return Err("original image too large".into());
    }
    let orig_mime = image_mime(&orig).ok_or("original is not a supported image")?;

    let (mut prev_b64, mut prev_mime) = (Value::Null, Value::Null);
    if let Some(prel) = it.get("preview").and_then(|x| x.as_str()) {
        if let Ok(p) = resolve_within(&dir, prel) {
            if let Ok(bytes) = fs::read(&p) {
                if bytes.len() <= MAX_IMAGE_BYTES {
                    if let Some(mime) = image_mime(&bytes) {
                        prev_b64 = json!(STANDARD.encode(&bytes));
                        prev_mime = json!(mime);
                    }
                }
            }
        }
    }

    // Normalize attributes to [{trait_type, value}] strings, capped.
    let mut attrs = Vec::new();
    if let Some(a) = it.get("attributes").and_then(|x| x.as_array()) {
        for at in a.iter().take(ATTRS_MAX) {
            let tt: String = at.get("trait_type").and_then(|x| x.as_str()).unwrap_or("").chars().take(STR_MAX).collect();
            let vv: String = at.get("value").and_then(|x| x.as_str()).unwrap_or("").chars().take(STR_MAX).collect();
            if !tt.is_empty() && !vv.is_empty() {
                attrs.push(json!({ "trait_type": tt, "value": vv }));
            }
        }
    }

    Ok(json!({
        "name": cap_str(it, "name"),
        "tier": it.get("tier").and_then(|x| x.as_str()).map(|s| s.chars().take(STR_MAX).collect::<String>()),
        "attributes": attrs,
        "originalB64": STANDARD.encode(&orig),
        "originalMime": orig_mime,
        "previewB64": prev_b64,
        "previewMime": prev_mime,
    }))
}

/// The only host DD69 trusts for a Kinet.ink launch bundle's art URLs. A bundle
/// that points anywhere else is rejected, so a tampered file can't aim the UI at
/// an arbitrary server. Update this if the Kinet.ink storage host ever changes.
const KINETINK_ART_PREFIX: &str = "https://matteqdhinpiwfnvxaef.supabase.co/";

/// Parse + validate a Kinet.ink *launch* bundle: a single `.json` in the v2
/// `kinetink-collection-launch` format (art referenced by URL, not embedded; a
/// priced set is mint-on-demand, so there is NO pre-mint). Returns a plan the UI
/// shows BEFORE anything is published: collection + sale + the on-chain rarity
/// config, plus a tier -> art-URL map for reveals. Nothing is fetched or
/// published here; every art URL must be on the trusted Kinet.ink host.
pub fn open_launch(json_path: &str) -> Result<Value, String> {
    let meta = fs::metadata(json_path).map_err(|_| "file not found".to_string())?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err("the launch file is too large".into());
    }
    let text = fs::read_to_string(json_path).map_err(|e| format!("cannot read file: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("not valid JSON: {e}"))?;
    if v.get("format").and_then(|x| x.as_str()) != Some("kinetink-collection-launch") {
        return Err("not a Kinet.ink launch bundle".into());
    }
    let version = v.get("version").and_then(|x| x.as_i64()).unwrap_or(0);
    if !(1..=2).contains(&version) {
        return Err("unsupported launch bundle version".into());
    }
    let col = v.get("collection").ok_or("bundle has no collection")?;
    let name = cap_str(col, "name");
    if name.is_empty() {
        return Err("collection name is required".into());
    }
    let description = cap_str(col, "description");

    // Primary sale: priceDuffs (integer), payoutAddress ("" = default to creator).
    let sale = col.get("sale");
    let price_duffs = sale.and_then(|s| s.get("priceDuffs")).and_then(|x| x.as_u64()).unwrap_or(0);
    let payout_address = sale.and_then(|s| s.get("payoutAddress")).and_then(|x| x.as_str()).unwrap_or("").to_string();

    // Every referenced art URL must be on the trusted Kinet.ink host.
    let check_url = |u: &str| -> Result<(), String> {
        if u.is_empty() || u.starts_with(KINETINK_ART_PREFIX) {
            Ok(())
        } else {
            Err("a bundle art URL is not on the trusted Kinet.ink host".to_string())
        }
    };

    let cover_url = col.get("images").and_then(|i| i.get("logo")).and_then(|l| l.get("url")).and_then(|x| x.as_str()).unwrap_or("").to_string();
    check_url(&cover_url)?;
    let packaged_art = col.get("packagedArt").and_then(|x| x.as_str()).unwrap_or("").to_string();
    check_url(&packaged_art)?;

    // Items: derive tier_count (highest non-UR tier) + the tier -> art-URL map.
    let items = v.get("items").and_then(|x| x.as_array()).ok_or("bundle has no items")?;
    if items.is_empty() {
        return Err("the bundle has no items".into());
    }
    if items.len() > MAX_ITEMS {
        return Err("the bundle has too many items".into());
    }
    let mut max_tier: u64 = 0;
    let mut ur_items: u64 = 0;
    let mut tier_art = serde_json::Map::new();
    for it in items {
        let tier = it.get("tier").and_then(|x| x.as_u64()).unwrap_or(0);
        let is_ur = it.get("isUltraRare").and_then(|x| x.as_bool()).unwrap_or(false);
        let img = it.get("media").and_then(|m| m.get("image")).and_then(|x| x.as_str()).unwrap_or("");
        check_url(img)?;
        if is_ur {
            ur_items += 1;
        } else {
            if tier > max_tier {
                max_tier = tier;
            }
            if tier >= 1 && !img.is_empty() {
                tier_art.insert(tier.to_string(), json!(img));
            }
        }
    }
    let tier_count = max_tier.max(1).min(u16::MAX as u64) as u16;

    // Ultra-rare config -> parts-per-million for the on-chain rarity record.
    let ur = col.get("ultraRare");
    let basic = ur.and_then(|u| u.get("basicChance")).and_then(|x| x.as_f64()).unwrap_or(0.0);
    let factor = ur.and_then(|u| u.get("progressiveFactor")).and_then(|x| x.as_f64()).unwrap_or(0.0);
    let ur_count = ur.and_then(|u| u.get("count")).and_then(|x| x.as_u64()).unwrap_or(ur_items).min(u16::MAX as u64) as u16;
    let to_ppm = |f: f64| -> u32 { (f.clamp(0.0, 1.0) * 1_000_000.0).round() as u32 };

    Ok(json!({
        "name": name,
        "description": description,
        "priceDuffs": price_duffs,
        "payoutAddress": payout_address,
        "rarity": {
            "tierCount": tier_count,
            "urBasicPpm": to_ppm(basic),
            "urProgressivePpm": to_ppm(factor),
            "urCount": ur_count,
        },
        "itemCount": items.len() as u64,
        "maxTier": max_tier,
        "urItemCount": ur_items,
        "coverUrl": if cover_url.is_empty() { Value::Null } else { json!(cover_url) },
        "packagedArt": if packaged_art.is_empty() { Value::Null } else { json!(packaged_art) },
        "tierArt": Value::Object(tier_art),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn cfg(datadir: PathBuf) -> NodeConfig {
        NodeConfig {
            datadir,
            rpc_host: String::new(),
            rpc_user: String::new(),
            rpc_pass: String::new(),
            rpc_port: 0,
            remote: false,
        }
    }

    fn write_zip(path: &Path, manifest: &str, png_name: &str) {
        let f = fs::File::create(path).unwrap();
        let mut zw = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default();
        zw.start_file("manifest.json", opts).unwrap();
        zw.write_all(manifest.as_bytes()).unwrap();
        zw.start_file(png_name, opts).unwrap();
        zw.write_all(b"\x89PNG\r\n\x1a\n-fake-png-body-").unwrap();
        zw.finish().unwrap();
    }

    #[test]
    fn open_and_read_item_roundtrip() {
        let base = std::env::temp_dir().join("nfd_import_roundtrip");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let c = cfg(base.join("datadir"));
        fs::create_dir_all(&c.datadir).unwrap();

        let zip_path = base.join("bundle.zip");
        let manifest = r#"{"format":"divi-collectibles-import","version":1,
            "collection":{"name":"Test","description":"d","maxSupply":2},
            "items":[{"edition":1,"name":"One","tier":"Rare","original":"originals/1.png",
              "attributes":[{"trait_type":"BG","value":"Blue"}]}]}"#;
        write_zip(&zip_path, manifest, "originals/1.png");

        let plan = open(&c, zip_path.to_str().unwrap()).unwrap();
        assert_eq!(plan["okCount"], 1);
        assert_eq!(plan["collection"]["name"], "Test");
        assert_eq!(plan["items"][0]["ok"], true);

        let dir = plan["importDir"].as_str().unwrap().to_string();
        let item = read_item(&c, &dir, 1).unwrap();
        assert_eq!(item["originalMime"], "image/png");
        assert!(!item["originalB64"].as_str().unwrap().is_empty());
        assert_eq!(item["attributes"][0]["trait_type"], "BG");
        assert!(item["previewB64"].is_null()); // no preview -> UI auto-generates
    }

    #[test]
    fn rejects_zip_slip_path_and_marks_bad_items() {
        let base = std::env::temp_dir().join("nfd_import_slip");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let c = cfg(base.join("datadir"));
        fs::create_dir_all(&c.datadir).unwrap();

        let zip_path = base.join("bundle.zip");
        // an item pointing outside the bundle must be marked not-ok, not read
        let manifest = r#"{"format":"divi-collectibles-import","version":1,
            "collection":{"name":"Bad","maxSupply":1},
            "items":[{"edition":1,"name":"Evil","original":"../../secret.png"}]}"#;
        write_zip(&zip_path, manifest, "originals/1.png");

        let plan = open(&c, zip_path.to_str().unwrap()).unwrap();
        assert_eq!(plan["okCount"], 0);
        assert_eq!(plan["items"][0]["ok"], false);
        // reading it must also fail (path escape rejected)
        let dir = plan["importDir"].as_str().unwrap().to_string();
        assert!(read_item(&c, &dir, 1).is_err());
    }

    #[test]
    fn open_launch_parses_v2_and_derives_rarity() {
        let base = std::env::temp_dir().join("nfd_launch_open");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let p = base.join("launch.json");
        let host = "https://matteqdhinpiwfnvxaef.supabase.co/x.png";
        let body = format!(
            r#"{{"format":"kinetink-collection-launch","version":2,
              "collection":{{"name":"Divi Rebels","description":"",
                "sale":{{"mode":"mint-on-demand","priceDuffs":20000000000,"payoutAddress":""}},
                "ultraRare":{{"basicChance":0.01,"progressiveFactor":0.5,"count":2}},
                "packagedArt":"{host}","images":{{"logo":{{"url":"{host}"}}}}}},
              "items":[
                {{"tier":1,"isUltraRare":false,"media":{{"image":"{host}"}}}},
                {{"tier":3,"isUltraRare":false,"media":{{"image":"{host}"}}}},
                {{"tier":1,"isUltraRare":true,"media":{{"image":"{host}"}}}}]}}"#
        );
        fs::write(&p, &body).unwrap();
        let plan = open_launch(p.to_str().unwrap()).unwrap();
        assert_eq!(plan["name"], "Divi Rebels");
        assert_eq!(plan["priceDuffs"], 20_000_000_000u64);
        assert_eq!(plan["rarity"]["tierCount"], 3); // highest non-UR tier
        assert_eq!(plan["rarity"]["urBasicPpm"], 10_000); // 0.01 -> ppm
        assert_eq!(plan["rarity"]["urProgressivePpm"], 500_000); // 0.5 -> ppm
        assert_eq!(plan["rarity"]["urCount"], 2);
        assert_eq!(plan["urItemCount"], 1);
        assert_eq!(plan["tierArt"]["3"], host);

        // An art URL on an untrusted host is rejected.
        let bad = body.replace("matteqdhinpiwfnvxaef.supabase.co", "evil.example.com");
        let bp = base.join("bad.json");
        fs::write(&bp, bad).unwrap();
        assert!(open_launch(bp.to_str().unwrap()).is_err());
    }
}
