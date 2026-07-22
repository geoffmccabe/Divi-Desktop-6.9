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
            "coverB64": cover_b64, "coverMime": cover_mime,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn cfg(datadir: PathBuf) -> NodeConfig {
        NodeConfig { datadir, rpc_user: String::new(), rpc_pass: String::new(), rpc_port: 0 }
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
}
