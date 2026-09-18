// ── Fast first sync: the official Divi chain snapshot ──────────────────────
//
// Without this a new user downloads 4.2 million blocks one at a time from
// peers. That is 7 GB of block files fetched over a protocol built for keeping
// up, not for catching up, and it takes days. The setup screen already offered
// a "fast · ~4.7 GB" option; it just never did anything, so people chose the
// fast path and got the slow one.
//
// WHAT THIS TRUSTS, STATED PLAINLY. The archive carries both the raw blocks and
// the chainstate (the spendable-coin index). Importing a chainstate means
// trusting whoever built it about who owns what, because the node accepts it
// rather than recomputing it. The archive is fetched over HTTPS from Divi's own
// snapshot server — the same origin the wallet itself comes from, so it adds no
// party that the user was not already trusting. It is NOT the same as
// verifying, and the difference should be visible to the user rather than
// buried here.
//
// The server publishes no checksum today. We record the SHA-256 of exactly what
// we received in the setup log, so a bad import can always be traced to the
// bytes that caused it, and so a published checksum can be pinned the moment
// one exists.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const SNAPSHOT_URL: &str = "https://snapshots.diviproject.org/dist/DIVI-snapshot.tar.gz";
/// Where a published checksum would live. Checked on every run: the moment the
/// snapshot server starts publishing one, verification turns itself on with no
/// change here and no new release.
pub const SNAPSHOT_SHA_URL: &str = "https://snapshots.diviproject.org/dist/DIVI-snapshot.tar.gz.sha256";

/// The checksum the server says the archive should have, if it publishes one.
///
/// Accepts either a bare hash or the usual `<hash>  <filename>` form that
/// `shasum` and `sha256sum` write, since whoever adds this to the server will
/// almost certainly generate it with one of those.
pub fn published_hash() -> Option<String> {
    let body = ureq::get(SNAPSHOT_SHA_URL).call().ok()?.into_string().ok()?;
    let first = body.split_whitespace().next()?.trim().to_lowercase();
    // A 404 page is not a checksum. Only 64 hex characters is.
    if first.len() == 64 && first.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(first)
    } else {
        None
    }
}

/// Is this actually a gzip archive?
///
/// A truncated transfer, a captive-portal login page or an HTML error saved as
/// .tar.gz all arrive looking like a file and fail much later with something
/// unreadable. Two bytes settle it before we act on five gigabytes.
fn looks_like_gzip(path: &Path) -> bool {
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 2];
    f.read_exact(&mut magic).is_ok() && magic == [0x1f, 0x8b]
}

/// Progress during the download and import.
pub struct Progress {
    /// Bytes fetched so far (includes a resumed partial file).
    pub done: u64,
    /// Total bytes, when the server tells us.
    pub total: Option<u64>,
    /// What is happening, in words a user can read.
    pub stage: String,
}

fn cache_path() -> Option<PathBuf> {
    Some(crate::config::dd69_datadir().join("snapshot-download.tar.gz"))
}

/// Ask the server how big it is, without downloading it.
///
/// Used to tell the user the real size and to check the disk BEFORE committing
/// them to a multi-gigabyte download.
pub fn remote_size() -> Option<u64> {
    let resp = ureq::head(SNAPSHOT_URL).call().ok()?;
    resp.header("content-length")?.parse().ok()
}

/// Is there already a chain here? If so we must not overwrite it.
pub fn chain_already_present() -> bool {
    let d = crate::config::dd69_datadir();
    // A handful of block files means a real sync is underway or done. An empty
    // or nearly-empty blocks dir is a fresh start.
    std::fs::read_dir(d.join("blocks"))
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("blk")).count() > 2)
        .unwrap_or(false)
}

/// Stream the archive to disk, resuming if a previous attempt left part of it.
///
/// Returns the SHA-256 of the complete file. A 4.7 GB download on a home
/// connection WILL be interrupted sometimes, so resuming is not a nicety: the
/// server supports byte ranges and without using them a dropped connection
/// means starting again from zero.
pub fn download(progress: &dyn Fn(Progress)) -> Result<(PathBuf, String), String> {
    let path = cache_path().ok_or("cannot work out where to put the download")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }

    let have = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let total = remote_size();

    // Already complete from an earlier run: hash it and move on rather than
    // fetching five gigabytes again.
    if let (Some(t), true) = (total, have > 0) {
        if have == t {
            progress(Progress { done: have, total, stage: "Checking the download already on disk…".into() });
            return Ok((path.clone(), hash_file(&path)?));
        }
        if have > t {
            // Longer than the source: a previous partial write went wrong, or
            // the snapshot was replaced by a smaller one. Start clean; an
            // append onto a stale file would produce a corrupt archive that
            // fails much later and much more confusingly.
            let _ = std::fs::remove_file(&path);
        }
    }

    let have = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let mut req = ureq::get(SNAPSHOT_URL);
    if have > 0 {
        req = req.set("Range", &format!("bytes={have}-"));
    }
    let resp = req.call().map_err(|e| format!("could not start the download: {e}"))?;
    let resuming = resp.status() == 206;
    if have > 0 && !resuming {
        // The server ignored our range request, so what follows is the WHOLE
        // file. Appending it to what we already have would silently corrupt it.
        let _ = std::fs::remove_file(&path);
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(resuming)
        .write(true)
        .truncate(!resuming)
        .open(&path)
        .map_err(|e| format!("cannot open the download file: {e}"))?;

    let mut done = if resuming { have } else { 0 };
    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; 1 << 20];
    let mut last_report = std::time::Instant::now();

    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("the download was interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("cannot write the download: {e}"))?;
        done += n as u64;
        if last_report.elapsed() >= std::time::Duration::from_millis(400) {
            last_report = std::time::Instant::now();
            progress(Progress { done, total, stage: "Downloading the chain snapshot…".into() });
        }
    }
    file.flush().map_err(|e| format!("cannot finish writing the download: {e}"))?;
    drop(file);

    if let Some(t) = total {
        let got = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if got != t {
            return Err(format!(
                "the download is incomplete ({got} of {t} bytes). It can be resumed by running setup again."
            ));
        }
    }

    progress(Progress { done, total, stage: "Checking the download…".into() });

    if !looks_like_gzip(&path) {
        let _ = std::fs::remove_file(&path);
        return Err("what was downloaded is not a snapshot archive (it may be an error page from the server or a captive portal). It has been discarded.".into());
    }

    let digest = hash_file(&path)?;
    crate::setuplog::log(format!("snapshot: downloaded {done} bytes, sha256 {digest}"));

    // Verify against the server's own checksum when it publishes one. This is
    // not about distrusting Divi: an ordinary connection can truncate or
    // corrupt a five-gigabyte transfer, and a silently corrupt chain is far
    // harder to diagnose later than a refused download now.
    match published_hash() {
        Some(expected) if expected != digest => {
            let _ = std::fs::remove_file(&path);
            crate::setuplog::log(format!(
                "snapshot: CHECKSUM MISMATCH — expected {expected}, got {digest}; discarded"
            ));
            return Err(format!(
                "the snapshot did not match its published checksum, so it was discarded. Expected {expected}, got {digest}."
            ));
        }
        Some(_) => crate::setuplog::log("snapshot: checksum verified against the published value"),
        None => crate::setuplog::log(
            "snapshot: the server publishes no checksum, so only the length was checked",
        ),
    }

    Ok((path, digest))
}

fn hash_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(path).map_err(|e| format!("cannot read the download: {e}"))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("cannot read the download: {e}"))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Unpack the archive into the node's data directory.
///
/// Refuses to run when a chain is already there. Overwriting a working chain —
/// or worse, mixing a snapshot into one — is not something to do silently to
/// somebody's wallet directory.
pub fn install(archive: &Path, progress: &dyn Fn(Progress)) -> Result<(), String> {
    if chain_already_present() {
        return Err("there is already a blockchain here, so the snapshot was not unpacked".into());
    }
    let datadir = crate::config::dd69_datadir();
    std::fs::create_dir_all(&datadir).map_err(|e| format!("cannot create {}: {e}", datadir.display()))?;

    progress(Progress { done: 0, total: None, stage: "Unpacking the snapshot (this takes a few minutes)…".into() });
    crate::setuplog::log("snapshot: unpacking into the data directory");

    // --strip-components is deliberately NOT assumed: archives differ in
    // whether they wrap their contents in a folder, so we unpack as-is and then
    // check that the directories we need actually arrived.
    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(&datadir)
        .status()
        .map_err(|e| format!("could not run tar: {e}"))?;
    if !status.success() {
        return Err("the snapshot archive could not be unpacked".into());
    }

    // Some snapshots wrap everything in a single top-level folder. If so, move
    // its contents up, rather than leaving a node that cannot find its chain.
    flatten_if_wrapped(&datadir)?;

    if !datadir.join("blocks").is_dir() {
        return Err("the snapshot did not contain a blocks folder, so it was not usable".into());
    }

    let _ = std::fs::remove_file(archive);
    crate::setuplog::log("snapshot: unpacked OK");
    progress(Progress { done: 0, total: None, stage: "Snapshot ready.".into() });
    Ok(())
}

/// If the archive unpacked into `<datadir>/<something>/blocks`, lift it up one
/// level so the node finds it where it expects.
fn flatten_if_wrapped(datadir: &Path) -> Result<(), String> {
    if datadir.join("blocks").is_dir() {
        return Ok(());
    }
    let Ok(entries) = std::fs::read_dir(datadir) else {
        return Ok(());
    };
    for e in entries.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_dir() && p.join("blocks").is_dir() {
            crate::setuplog::log(format!(
                "snapshot: archive was wrapped in {}, lifting its contents up",
                p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
            ));
            let inner = std::fs::read_dir(&p).map_err(|e| format!("cannot read {}: {e}", p.display()))?;
            for item in inner.filter_map(|i| i.ok()) {
                let from = item.path();
                let to = datadir.join(item.file_name());
                std::fs::rename(&from, &to)
                    .map_err(|e| format!("cannot move {} into place: {e}", from.display()))?;
            }
            let _ = std::fs::remove_dir(&p);
            return Ok(());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_real_hash_counts_as_a_checksum() {
        // Whatever a 404 page says, it is not a checksum.
        let ok = "a".repeat(64);
        assert_eq!(ok.len(), 64);
        assert!(ok.chars().all(|c| c.is_ascii_hexdigit()));
        for bad in ["<html>404</html>", "", "not-a-hash", &"z".repeat(64), &"a".repeat(63)] {
            let first = bad.split_whitespace().next().unwrap_or("").to_lowercase();
            let accepted = first.len() == 64 && first.chars().all(|c| c.is_ascii_hexdigit());
            assert!(!accepted, "should have rejected {bad:?}");
        }
    }

    #[test]
    fn an_html_error_page_is_not_mistaken_for_an_archive() {
        let tmp = std::env::temp_dir().join(format!("dd69-gz-{}", std::process::id()));
        std::fs::write(&tmp, b"<html><head><title>404 Not Found</title>").unwrap();
        assert!(!looks_like_gzip(&tmp), "an HTML page must not pass as a gzip archive");
        std::fs::write(&tmp, [0x1f, 0x8b, 0x08, 0x00]).unwrap();
        assert!(looks_like_gzip(&tmp), "a real gzip header must pass");
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn a_wrapped_archive_is_lifted_into_place() {
        let tmp = std::env::temp_dir().join(format!("dd69-snap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("DIVI-snapshot/blocks")).unwrap();
        std::fs::create_dir_all(tmp.join("DIVI-snapshot/chainstate")).unwrap();
        flatten_if_wrapped(&tmp).unwrap();
        assert!(tmp.join("blocks").is_dir(), "blocks should have been lifted up");
        assert!(tmp.join("chainstate").is_dir(), "chainstate should have been lifted up");
        assert!(!tmp.join("DIVI-snapshot").exists(), "the wrapper should be gone");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn an_unwrapped_archive_is_left_alone() {
        let tmp = std::env::temp_dir().join(format!("dd69-snap2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("blocks")).unwrap();
        flatten_if_wrapped(&tmp).unwrap();
        assert!(tmp.join("blocks").is_dir());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

/// Replace a chain that cannot be repaired, without involving the user.
///
/// The recovery ladder rebuilds from the block files already on disk, which
/// handles most damage and needs no download. When even that fails the block
/// files themselves are bad, and the only remaining cure is new data.
///
/// This used to be a sentence telling the user to "restore from the Divi
/// snapshot", which in practice meant asking them to find a folder in their
/// Library and delete parts of it by hand. Nobody should have to do that to
/// their wallet, and one wrong click in there deletes wallet.dat.
///
/// ONLY blocks/ and chainstate/ are removed. Both are public data that the
/// network hands back on request. wallet.dat, the config and the backups are
/// never touched, and the wallet is checked to be present afterwards so a bug
/// here can never quietly take someone's keys with it.
pub fn replace_damaged_chain(progress: &dyn Fn(Progress)) -> Result<(), String> {
    let datadir = crate::config::dd69_datadir();
    let wallet = datadir.join("wallet.dat");
    let had_wallet = wallet.is_file();

    crate::setuplog::log("recovery: the chain could not be repaired; replacing the downloaded data");
    progress(Progress {
        done: 0,
        total: None,
        stage: "Replacing damaged blockchain data (your wallet is untouched)…".into(),
    });

    for dir in ["blocks", "chainstate"] {
        let path = datadir.join(dir);
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("could not remove the damaged {dir} folder: {e}"))?;
            crate::setuplog::log(format!("recovery: removed {dir}"));
        }
    }

    if had_wallet && !wallet.is_file() {
        return Err("aborted: the wallet file went missing during recovery".into());
    }

    let (archive, digest) = download(progress)?;
    crate::setuplog::log(format!("recovery: fresh snapshot downloaded, sha256 {digest}"));
    install(&archive, progress)?;

    if had_wallet && !wallet.is_file() {
        return Err("aborted: the wallet file went missing while unpacking the snapshot".into());
    }
    crate::setuplog::log("recovery: chain replaced from the snapshot");
    Ok(())
}
