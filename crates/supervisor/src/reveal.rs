// Perc reveal — the blind "open the pack" roll. A Perc is sold sealed; when the
// owner reveals it, this rolls (a) the base tier on the standard halving curve and
// (b) an optional Ultra Rare overlay. Both are drawn from the SAME fair seed used
// for forging (a future block hash the owner can't predict), so a reveal can't be
// gamed. See docs/NFD-REVEAL-UR.md.
//
// Rarity factor f: P(tier k) = (1-f)·f^(k-1). f = 0.5 gives the base tiers
// (50% / 25% / 12.5% …); a smaller f (e.g. 0.10 → 90% / 9% / 0.9%) gives the URs.

use sha2::{Digest, Sha256};

/// A uniform value in [0,1) derived from the seed and a domain `tag`, so the base
/// tier, the UR gate, and the UR tier are independent draws off one seed.
fn uniform(seed: &[u8], tag: u8) -> f64 {
    let mut h = Sha256::new();
    h.update([tag]);
    h.update(seed);
    let d: [u8; 32] = h.finalize().into();
    let mut x: u64 = 0;
    for b in &d[0..7] {
        x = (x << 8) | *b as u64; // 56 bits
    }
    (( x >> 3) as f64) / ((1u64 << 53) as f64) // top 53 bits -> [0,1)
}

/// Geometric tier draw: P(k) = (1-factor)·factor^(k-1), k in 1..=cap (higher =
/// rarer). Anything past `cap` folds into `cap`.
pub fn draw_geometric(u: f64, factor: f64, cap: u32) -> u32 {
    if cap <= 1 || !(0.0..1.0).contains(&factor) || factor <= 0.0 {
        return 1;
    }
    let k = ((1.0 - u).ln() / factor.ln()).floor() as i64 + 1;
    (k.max(1) as u32).min(cap)
}

/// Reveal parameters — from the collection / set JSON. `ur_count == 0` = no URs.
pub struct RevealConfig {
    pub base_factor: f64, // 0.5 = the standard halving tiers
    pub num_tiers: u32,   // how many base tier artworks exist (e.g. 40)
    pub ur_chance: f64,   // e.g. 0.01 (1%)
    pub ur_factor: f64,   // e.g. 0.10 (90/9/0.9)
    pub ur_count: u32,    // how many UR artworks exist (0 = none)
}

pub struct RevealOutcome {
    pub base_tier: u32,          // 1..=num_tiers
    pub ur_tier: Option<u32>,    // Some(1..=ur_count) when the UR gate hits
}

/// Roll a sealed Perc's reveal from a fair seed (forge/reveal block hash).
pub fn reveal(seed: &[u8], cfg: &RevealConfig) -> RevealOutcome {
    let base_tier = draw_geometric(uniform(seed, 1), cfg.base_factor, cfg.num_tiers);
    let ur_tier = if cfg.ur_count > 0 && cfg.ur_chance > 0.0 && uniform(seed, 2) < cfg.ur_chance {
        Some(draw_geometric(uniform(seed, 3), cfg.ur_factor, cfg.ur_count))
    } else {
        None
    };
    RevealOutcome { base_tier, ur_tier }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(i: u32) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"reveal-test");
        h.update(i.to_le_bytes());
        h.finalize().into()
    }

    #[test]
    fn geometric_boundaries() {
        // f = 0.5: u<0.5 -> T1, [0.5,0.75) -> T2, [0.75,0.875) -> T3
        assert_eq!(draw_geometric(0.10, 0.5, 40), 1);
        assert_eq!(draw_geometric(0.60, 0.5, 40), 2);
        assert_eq!(draw_geometric(0.80, 0.5, 40), 3);
        assert_eq!(draw_geometric(0.999999, 0.5, 5), 5); // capped
        // f = 0.1: u<0.9 -> T1, [0.9,0.99) -> T2
        assert_eq!(draw_geometric(0.5, 0.1, 5), 1);
        assert_eq!(draw_geometric(0.95, 0.1, 5), 2);
    }

    #[test]
    fn base_tiers_are_5025125_and_urs_are_1pct_90_9() {
        let n = 400_000u32;
        let cfg = RevealConfig { base_factor: 0.5, num_tiers: 40, ur_chance: 0.01, ur_factor: 0.10, ur_count: 5 };
        let (mut t1, mut t2, mut t3) = (0u32, 0u32, 0u32);
        let (mut ur_hits, mut ur1, mut ur2) = (0u32, 0u32, 0u32);
        for i in 0..n {
            let o = reveal(&seed(i), &cfg);
            match o.base_tier {
                1 => t1 += 1,
                2 => t2 += 1,
                3 => t3 += 1,
                _ => {}
            }
            if let Some(ur) = o.ur_tier {
                ur_hits += 1;
                match ur {
                    1 => ur1 += 1,
                    2 => ur2 += 1,
                    _ => {}
                }
            }
        }
        let p = |c: u32| c as f64 / n as f64;
        // Base tiers: 50 / 25 / 12.5
        assert!((p(t1) - 0.5).abs() < 0.01, "T1 {}", p(t1));
        assert!((p(t2) - 0.25).abs() < 0.01, "T2 {}", p(t2));
        assert!((p(t3) - 0.125).abs() < 0.01, "T3 {}", p(t3));
        // UR gate ~1%
        assert!((p(ur_hits) - 0.01).abs() < 0.003, "UR rate {}", p(ur_hits));
        // Among URs: ~90% UR-T1, ~9% UR-T2
        let among = |c: u32| c as f64 / ur_hits.max(1) as f64;
        assert!((among(ur1) - 0.9).abs() < 0.05, "UR-T1 share {}", among(ur1));
        assert!((among(ur2) - 0.09).abs() < 0.04, "UR-T2 share {}", among(ur2));
    }
}
