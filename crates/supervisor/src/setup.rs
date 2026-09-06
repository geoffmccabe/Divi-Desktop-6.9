//! First-run setup detection. Read-only: it only looks at the disk to decide
//! which "track" a user is on and what local data we could reuse. It never
//! copies, downloads, or starts anything — those live in `install.rs`.
//!
//! Three tracks:
//!   - "new"   : no local Divi data anywhere -> fresh setup (snapshot or peers).
//!   - "dd2"   : Divi Desktop 2.0 data found -> offer to reuse its chain+wallet.
//!   - "ready" : DD69 already has its own blockchain -> no setup needed.

use crate::config::{dd69_datadir, default_datadir};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Default, Clone)]
pub struct SetupInfo {
    /// "new" | "dd2" | "ready".
    pub track: String,
    /// True while DD69 has no usable local chain yet (the setup panel shows).
    pub needs_setup: bool,
    /// DD69 already has blocks on disk.
    pub dd69_has_chain: bool,
    /// Divi Desktop 2.0 blockchain present and reusable.
    pub dd2_has_chain: bool,
    /// Divi Desktop 2.0 wallet.dat present and importable.
    pub dd2_has_wallet: bool,
    /// Approx size of the DD2.0 blockchain in GB (for the reuse-offer copy).
    pub dd2_chain_gb: f64,
    /// DD2.0 data sits on the same disk volume as DD69 -> an instant, zero-space
    /// APFS clone is possible instead of a slow full copy.
    pub same_volume: bool,
}

impl SetupInfo {
    /// camelCase JSON for the UI (the supervisor crate has serde_json, not the
    /// serde derive, so we shape it by hand).
    pub fn to_json(&self) -> Value {
        json!({
            "track": self.track,
            "needsSetup": self.needs_setup,
            "dd69HasChain": self.dd69_has_chain,
            "dd2HasChain": self.dd2_has_chain,
            "dd2HasWallet": self.dd2_has_wallet,
            "dd2ChainGb": self.dd2_chain_gb,
            "sameVolume": self.same_volume,
        })
    }
}

/// A datadir "has a chain" if its blocks/ folder holds at least one blk*.dat.
fn has_blocks(datadir: &Path) -> bool {
    let blocks = datadir.join("blocks");
    let Ok(rd) = std::fs::read_dir(&blocks) else { return false };
    rd.flatten().any(|e| {
        e.file_name()
            .to_string_lossy()
            .starts_with("blk")
    })
}

/// Shallow-sum the bytes in blocks/ and chainstate/ (one level plus blocks/index).
/// Fast: metadata only, ~dozens of files, no deep recursion needed for a size hint.
fn chain_size_gb(datadir: &Path) -> f64 {
    let mut bytes: u64 = 0;
    for sub in ["blocks", "blocks/index", "chainstate"] {
        if let Ok(rd) = std::fs::read_dir(datadir.join(sub)) {
            for e in rd.flatten() {
                if let Ok(m) = e.metadata() {
                    if m.is_file() {
                        bytes += m.len();
                    }
                }
            }
        }
    }
    (bytes as f64) / 1_073_741_824.0
}

/// Do two paths live on the same filesystem volume? On unix we compare the
/// device id; DD69's datadir may not exist yet, so we test its nearest existing
/// ancestor. On other platforms we conservatively say "no" (fall back to copy).
#[cfg(unix)]
fn same_volume(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let dev = |p: &Path| -> Option<u64> {
        let mut cur = p;
        loop {
            if let Ok(m) = std::fs::metadata(cur) {
                return Some(m.dev());
            }
            cur = cur.parent()?;
        }
    };
    match (dev(a), dev(b)) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}
#[cfg(not(unix))]
fn same_volume(_a: &Path, _b: &Path) -> bool {
    false
}

/// Look at the disk and decide the track. Never mutates anything.
pub fn detect() -> SetupInfo {
    let dd69 = dd69_datadir();
    let dd2 = default_datadir();

    let dd69_has_chain = has_blocks(&dd69);
    let dd2_has_chain = has_blocks(&dd2);
    let dd2_has_wallet = dd2.join("wallet.dat").is_file();

    let track = if dd69_has_chain {
        "ready"
    } else if dd2_has_chain || dd2_has_wallet {
        "dd2"
    } else {
        "new"
    };

    SetupInfo {
        track: track.to_string(),
        needs_setup: !dd69_has_chain,
        dd69_has_chain,
        dd2_has_chain,
        dd2_has_wallet,
        dd2_chain_gb: if dd2_has_chain { chain_size_gb(&dd2) } else { 0.0 },
        same_volume: same_volume(&dd2, &dd69),
        ..Default::default()
    }
}
