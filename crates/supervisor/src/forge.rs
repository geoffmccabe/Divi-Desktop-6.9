// NFD forging — the PERC upgrade mechanic. Burn two NFDs of the SAME tier, pay
// the forge fee, and re-roll a guaranteed upgrade: +1 tier at 50%, +2 at 25%,
// +3 at 12.5%, … up to +40. The result tier may exceed 40 (it reuses T40 art).
// See docs/NFD-FORGING.md.
//
// FAIRNESS: the roll is derived from a seed the forger cannot predict or grind —
// the hash of a FUTURE block (chosen at forge time) combined with the forge txid.
// The forger has already burned the inputs and paid the fee before that block
// exists, so there is no retry, and the outcome is deterministic + verifiable by
// anyone from the block hash. This module is the pure roll; the on-chain flow
// (commit + resolve) lives in collectibles.rs.

use sha2::{Digest, Sha256};

/// Largest tier bump forging can grant (result tier may still exceed 40).
pub const MAX_BUMP: u32 = 40;

/// Draw the tier bump K in 1..=40 from a 32-byte seed.
/// Treat the seed's bits as fair coin flips (MSB first): K = (leading 1-bits) + 1,
/// capped at 40. So P(K=1)=1/2, P(K=2)=1/4, …, P(K=k)=1/2^k — exactly the spec.
pub fn draw_tier_bump(seed: &[u8]) -> u32 {
    let mut heads: u32 = 0;
    'outer: for &byte in seed {
        for i in (0..8).rev() {
            if (byte >> i) & 1 == 1 {
                heads += 1;
                if heads + 1 >= MAX_BUMP {
                    break 'outer; // 39 heads => K capped at 40
                }
            } else {
                break 'outer; // first tail ends the run
            }
        }
    }
    (heads + 1).min(MAX_BUMP)
}

/// The forge seed: sha256(forge_txid_bytes || resolve_block_hash_bytes). Neither
/// party can steer it — the block hash is unknown when the forge is committed.
pub fn forge_seed(forge_txid_hex: &str, block_hash_hex: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(forge_txid_hex.trim().to_lowercase().as_bytes());
    h.update(block_hash_hex.trim().to_lowercase().as_bytes());
    h.finalize().into()
}

/// Full outcome: from same-tier inputs `tier`, the result tier = tier + bump.
pub fn forge_result_tier(input_tier: u32, seed: &[u8]) -> u32 {
    input_tier + draw_tier_bump(seed)
}

/// Which tier's ARTWORK a result tier uses: itself up to 40, else T40's art.
pub fn art_tier_for(result_tier: u32) -> u32 {
    result_tier.min(40)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bump_bounds() {
        assert_eq!(draw_tier_bump(&[0x00; 32]), 1); // first flip tail -> +1
        assert_eq!(draw_tier_bump(&[0xff; 32]), 40); // all heads -> capped +40
        // 0b1011_.. : one head then tail -> +2
        assert_eq!(draw_tier_bump(&[0b1011_1111, 0, 0]), 2);
        // 0b1100_.. : two heads then tail -> +3
        assert_eq!(draw_tier_bump(&[0b1100_0000, 0, 0]), 3);
    }

    #[test]
    fn art_mapping_reuses_t40_beyond_40() {
        assert_eq!(art_tier_for(37), 37);
        assert_eq!(art_tier_for(40), 40);
        assert_eq!(art_tier_for(45), 40);
        assert_eq!(forge_result_tier(38, &[0b1111_1110, 0, 0]), 38 + 8); // 7 heads -> +8
    }

    #[test]
    fn distribution_matches_halving() {
        // Deterministic pseudo-seeds; tally the bump distribution over 200k draws.
        let n = 200_000u32;
        let mut counts = [0u32; 42];
        for i in 0..n {
            let seed: [u8; 32] = {
                let mut h = Sha256::new();
                h.update(b"forge-dist-test");
                h.update(i.to_le_bytes());
                h.finalize().into()
            };
            counts[draw_tier_bump(&seed) as usize] += 1;
        }
        let p = |k: usize| counts[k] as f64 / n as f64;
        // Within 1.5% absolute of the ideal 1/2^k.
        assert!((p(1) - 0.5).abs() < 0.015, "P(+1)={} expected .5", p(1));
        assert!((p(2) - 0.25).abs() < 0.015, "P(+2)={} expected .25", p(2));
        assert!((p(3) - 0.125).abs() < 0.015, "P(+3)={} expected .125", p(3));
        assert!((p(4) - 0.0625).abs() < 0.01, "P(+4)={} expected .0625", p(4));
        assert_eq!(counts[0], 0, "bump is never 0 — always an upgrade");
    }
}
