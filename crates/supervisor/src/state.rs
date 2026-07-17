use serde_json::Value;

/// A synced Divi node's tip should be very fresh — the network targets ~60s
/// blocks. If the newest block is older than this, we're still catching up.
/// This heuristic needs no version-specific RPC fields, just the tip's
/// timestamp and the wall clock.
pub const SYNC_FRESH_SECS: i64 = 180;

/// The machine-readable phase the wallet is in. The transient phases
/// (Starting/Repairing/Stopping) are emitted by the action that causes them;
/// the rest are derived from the running node.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Phase {
    Stopped,
    CrashedNeedsRepair,
    Starting,
    NoPeers,
    Syncing,
    Synced,
    Staking,
}

impl Phase {
    /// A stable slug the future UI can switch on.
    pub fn slug(self) -> &'static str {
        match self {
            Phase::Stopped => "stopped",
            Phase::CrashedNeedsRepair => "crashed",
            Phase::Starting => "starting",
            Phase::NoPeers => "no-peers",
            Phase::Syncing => "syncing",
            Phase::Synced => "synced",
            Phase::Staking => "staking",
        }
    }
}

/// One assessment of a running node: the phase plus the single human sentence
/// the user should see. This is the whole messaging catalogue for the running
/// states — one place, so no screen invents its own wording.
pub struct Health {
    pub phase: Phase,
    pub headline: String,
}

fn human_duration(secs: i64) -> String {
    // saturating_add so a sentinel like i64::MAX ("age unknown / very stale")
    // can't overflow the rounding offsets and panic.
    let s = secs.max(0);
    if s < 90 {
        format!("{s} seconds")
    } else if s < 5400 {
        format!("about {} minutes", s.saturating_add(30) / 60)
    } else if s < 172_800 {
        format!("about {} hours", s.saturating_add(1800) / 3600)
    } else {
        format!("about {} days", s.saturating_add(43_200) / 86_400)
    }
}

/// Derive the running-node health from three cheap facts: how many peers we
/// have, how old the newest block is, and the staking status object.
pub fn assess(peers: i64, tip_age_secs: i64, staking: &Value) -> Health {
    if peers <= 0 {
        return Health {
            phase: Phase::NoPeers,
            headline: "The node is running but has no network connections yet — searching for peers."
                .into(),
        };
    }
    if tip_age_secs > SYNC_FRESH_SECS {
        return Health {
            phase: Phase::Syncing,
            headline: format!(
                "Syncing the blockchain — about {} behind. This catches up on its own; you can keep using the wallet.",
                human_duration(tip_age_secs)
            ),
        };
    }
    // Fresh tip + peers = caught up. Staking is the only question left.
    if staking["staking status"].as_bool() == Some(true) {
        return Health {
            phase: Phase::Staking,
            headline: "Fully synced and actively staking. ✓".into(),
        };
    }
    Health {
        phase: Phase::Synced,
        headline: format!("Fully synced. {}", staking_reason_not_staking(staking)),
    }
}

/// Maps getstakingstatus fields to one plain reason staking is off. First
/// blocker in priority order wins.
pub fn staking_reason_not_staking(s: &Value) -> String {
    let checks: [(&str, &str); 6] = [
        ("haveconnections", "Not staking yet: no network connections."),
        ("mnsync", "Not staking yet: still syncing with the network."),
        ("walletunlocked", "Not staking: the wallet is locked. Unlock it to start staking."),
        ("enoughcoins", "Not staking: your balance is below the staking minimum."),
        ("mintablecoins", "Not staking: your coins aren't mature enough yet."),
        ("validtime", "Not staking: the node's clock isn't in sync yet."),
    ];
    for (field, sentence) in checks {
        if s[field].as_bool() == Some(false) {
            return sentence.into();
        }
    }
    "Not staking (reason unknown — this is a bug; the app should always know why).".into()
}

/// Kept for the plain staking readout: full sentence including the active case.
pub fn staking_sentence(s: &Value) -> String {
    if s["staking status"].as_bool() == Some(true) {
        "Staking is ACTIVE.".into()
    } else {
        staking_reason_not_staking(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn staking_on() -> Value {
        json!({"staking status": true})
    }
    fn staking_off_locked() -> Value {
        json!({"staking status": false, "haveconnections": true, "mnsync": true, "walletunlocked": false})
    }

    #[test]
    fn no_peers_beats_everything() {
        let h = assess(0, 5, &staking_on());
        assert_eq!(h.phase, Phase::NoPeers);
    }

    #[test]
    fn stale_tip_means_syncing() {
        let h = assess(8, 3600, &staking_on());
        assert_eq!(h.phase, Phase::Syncing);
        assert!(h.headline.contains("behind"));
        assert!(assess(8, 7200, &staking_on()).headline.contains("hours"));
    }

    #[test]
    fn fresh_tip_and_staking() {
        let h = assess(8, 20, &staking_on());
        assert_eq!(h.phase, Phase::Staking);
    }

    #[test]
    fn fresh_tip_not_staking_says_why() {
        let h = assess(8, 20, &staking_off_locked());
        assert_eq!(h.phase, Phase::Synced);
        assert!(h.headline.contains("locked"));
    }

    #[test]
    fn duration_wording() {
        assert!(human_duration(30).contains("seconds"));
        assert!(human_duration(600).contains("minutes"));
        assert!(human_duration(7200).contains("hours"));
        assert!(human_duration(300_000).contains("days"));
    }
}
