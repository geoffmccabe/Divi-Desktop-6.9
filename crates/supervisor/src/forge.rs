// NFD forging — the PERC upgrade mechanic. Burn two NFDs of the SAME group and
// tier, pay the collection's forge fee, and re-roll a guaranteed upgrade. The
// roll is per-GROUP (the base/main set or a specific Ultra-Rare set), driven by
// that group's dials: a MODE (+1-only or variable climb) and, for variable, a
// per-step climb chance. +1 at `continue_ppm`, +2 at `continue_ppm`², … The
// result tier may exceed the group's art count — the number keeps climbing, the
// ARTWORK caps at the top available tier. See docs/NFD-FORGING.md.
//
// FAIRNESS: the roll is derived from a seed the forger cannot predict or grind —
// the hash of a FUTURE block (chosen at forge time) combined with the forge txid.
// The forger has already burned the inputs and paid the fee before that block
// exists, so there is no retry, and the outcome is deterministic + verifiable by
// anyone from the block hash. This module is the pure roll; the on-chain flow
// (commit + resolve) lives in collectibles.rs. The AUTHORITATIVE roll is the
// indexer's `forge_climb` (nfd-indexer); this mirrors its distribution for the
// wallet's preview.

use sha2::{Digest, Sha256};

/// Forge modes, matching the indexer's on-chain byte: 0 = off, 1 = +1-only,
/// 2 = variable.
pub const MODE_OFF: u8 = 0;
pub const MODE_PLUS1: u8 = 1;
pub const MODE_VARIABLE: u8 = 2;

/// Largest climb a single forge can grant (a safety cap so a pathological seed
/// can't loop unbounded; the result tier may still exceed a group's art count).
pub const MAX_BUMP: u32 = 40;

/// The climb K (>= 1) from a seed under a group's dials.
/// - `MODE_PLUS1` (and defensively `MODE_OFF`) -> always 1.
/// - `MODE_VARIABLE` -> 1 plus the consecutive "continue" rolls at `continue_ppm`
///   (500_000 = 50% -> +1 50% / +2 25% / …), capped at `MAX_BUMP`. Uses the same
///   word()/cont() integer draw as the indexer so the distribution matches.
pub fn climb(seed: &[u8], mode: u8, continue_ppm: u32) -> u32 {
    if mode != MODE_VARIABLE {
        return 1;
    }
    let word = |n: u32| -> u32 {
        let mut h = Sha256::new();
        h.update(seed);
        h.update(n.to_le_bytes());
        let d = h.finalize();
        u32::from_le_bytes([d[0], d[1], d[2], d[3]])
    };
    let cont = |w: u32, ppm: u32| -> bool { ppm >= 1_000_000 || (w as u64) < (((ppm as u64) << 32) / 1_000_000) };
    let mut k = 1u32;
    let mut i = 0u32;
    while k < MAX_BUMP && cont(word(40_000 + i), continue_ppm) {
        k += 1;
        i += 1;
    }
    k
}

/// The forge seed: sha256(forge_txid_bytes || resolve_block_hash_bytes). Neither
/// party can steer it — the block hash is unknown when the forge is committed.
pub fn forge_seed(forge_txid_hex: &str, block_hash_hex: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(forge_txid_hex.trim().to_lowercase().as_bytes());
    h.update(block_hash_hex.trim().to_lowercase().as_bytes());
    h.finalize().into()
}

/// Result tier = input tier + the climb under this group's dials.
pub fn forge_result_tier(input_tier: u32, mode: u8, continue_ppm: u32, seed: &[u8]) -> u32 {
    input_tier + climb(seed, mode, continue_ppm)
}

/// Which tier's ARTWORK a result uses: itself up to the group's art count, else
/// the top available art. The tier NUMBER keeps climbing; only the art caps.
pub fn art_tier_for(result_tier: u32, art_count: u32) -> u32 {
    result_tier.min(art_count.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plus1_is_always_one() {
        assert_eq!(climb(&[0x00; 32], MODE_PLUS1, 0), 1);
        assert_eq!(climb(&[0xff; 32], MODE_PLUS1, 0), 1);
        assert_eq!(climb(&[0xff; 32], MODE_OFF, 0), 1); // defensive
    }

    #[test]
    fn variable_is_always_an_upgrade_and_capped() {
        for i in 0..2000u32 {
            let mut h = Sha256::new();
            h.update(b"forge-climb-bounds");
            h.update(i.to_le_bytes());
            let s: [u8; 32] = h.finalize().into();
            let k = climb(&s, MODE_VARIABLE, 500_000);
            assert!(k >= 1 && k <= MAX_BUMP, "k={k}");
        }
    }

    #[test]
    fn art_caps_but_number_climbs() {
        // 30 art tiers: tier 34 still shows tier 30's art.
        assert_eq!(art_tier_for(29, 30), 29);
        assert_eq!(art_tier_for(30, 30), 30);
        assert_eq!(art_tier_for(34, 30), 30);
        // result_tier is unbounded by art; forge_result_tier returns the number.
        assert!(forge_result_tier(29, MODE_PLUS1, 0, &[0u8; 32]) == 30);
    }

    #[test]
    fn variable_matches_halving_at_50_and_bends_at_25() {
        let dist = |ppm: u32, tag: &[u8]| -> (f64, f64) {
            let n = 40_000u32;
            let (mut k1, mut k2) = (0u32, 0u32);
            for i in 0..n {
                let mut h = Sha256::new();
                h.update(tag);
                h.update(i.to_le_bytes());
                let s: [u8; 32] = h.finalize().into();
                match climb(&s, MODE_VARIABLE, ppm) {
                    1 => k1 += 1,
                    2 => k2 += 1,
                    _ => {}
                }
            }
            (k1 as f64 / n as f64, k2 as f64 / n as f64)
        };
        let (p1, p2) = dist(500_000, b"fp-50");
        assert!((p1 - 0.5).abs() < 0.02, "P(+1)@50%={p1}");
        assert!((p2 - 0.25).abs() < 0.02, "P(+2)@50%={p2}");
        let (q1, _) = dist(250_000, b"fp-25");
        assert!((q1 - 0.75).abs() < 0.03, "P(+1)@25%={q1}");
    }
}
