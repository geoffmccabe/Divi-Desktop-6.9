# Rebrand Plan: DIVA → DIVINA

**Status:** Analysis + action list. **Nothing has been renamed.** Do NOT execute until Geoff says go.
**Date:** 2026-Oct-31
**Decision:** The EVM side-chain is renamed from **DIVA** to **DIVINA** everywhere: all docs, all files, all code, all names. (Geoff, 2026-Oct-31.)
**Bonus:** "DIVINA" means *divine* (feminine) in Spanish, a natural fit for the Costa Rica identity.

---

## 1. Scope (grounded in an actual read-only survey)

The brand "DIVA" appears in **four areas**, roughly **554 text occurrences across ~37 files**, plus some file/directory names.

| Area | Files | Matches | What it is |
|---|---|---|---|
| DD69 `docs/` | 11 | 279 | Planning docs only. **No DD69 code references DIVA.** |
| `~/diva` workspace (ours) | 18 | 208 | Plan docs, shell scripts, bridge Solidity, storage scripts, genesis JSON |
| `Divilovescan` | 5 | 54 | **LIVE** explorer: frontend code + a Cloudflare function + a theme class |
| `Divi-Blockchain_6.9` | 3 | 13 | Prose "DIVA lane/side" in 2 docs + 1 code comment |

Case split (our files): **333 `DIVA`**, **120 `diva`**, **98 `Diva`** → the replace must be case-aware.

## 2. Key findings

1. **The upstream chain clients need no editing.** `~/diva/bsc` and `~/diva/go-ethereum` (206MB+) contain **zero** references to our brand; the only hits are coincidences in an Ethereum function-signature database (`divAmt()`, `testDivAdd()`). Our customizations live in the genesis JSON, scripts, and the bridge/storage folders, not in the vendored Go source.
2. **No GitHub repo renames needed.** `~/diva` is a local-only git repo (no remote). `Divilovescan` is a "**Divi**" name, not "Diva", so it stays.
3. **DIVINA is already half-adopted.** `docs/DIVI-DIVA-WHITEPAPER-OUTLINE.md` (v0.2) already uses DIVINA in its public copy, and it contains an earlier, deliberate decision to *keep* the on-disk "DIVA" spelling for findability. **This rebrand overrides that earlier decision** (Geoff now wants the on-disk names changed too). Update that note when editing the whitepaper.

## 3. The one real hazard, and why it is manageable

"DIVA" and "DIVI" differ by one letter. A replace targeting the literal string "diva" **cannot** match "divi" (the fourth letter differs), so the mechanical risk is low **provided no fuzzy pattern like `DIV[AI]` is ever used.** The subtle trap is the "Divi"-words that must stay, especially **DiviStore / DIVISTORE** (87 occurrences), plus DiviGo, divid69, divi.love. Example of the required precision: `DIVA-STORAGE-DIVISTORE.md` → `DIVINA-STORAGE-DIVISTORE.md` (the DIVA part changes; DIVISTORE does not).

Case-aware mapping, scoped to our files only: `DIVA→DIVINA`, `Diva→Divina`, `diva→divina`. Verified: inside our own files every lowercase "diva" is genuinely our brand (paths/scripts/identifiers), so a scoped blanket map is safe there.

## 4. Protect list (NEVER rename)

Divi / DIVI / divi; DiviStore / DIVISTORE; DiviGo; divid69; Divilovescan; divi.love / scan.divi.love; chain id **1838**; the DVXP protocol tags and the frozen NFD registry wire format (none contain "diva"); the `bsc` / `go-ethereum` upstream trees; git history (do not rewrite commit messages).

## 5. Decisions assumed (confirm if any is wrong)

- Full rename everywhere, **including the `~/diva` directory itself** → `~/divina`. This is the single biggest ripple: every doc and memory citing `/Users/geoffreymccabe/diva/...` must update in lockstep. A temporary symlink `~/diva → ~/divina` can prevent breakage during transition.
- Final spelling is **DIVINA** (caps DIVINA / title Divina / lower divina).
- Chain id 1838 and all "Divi"/DiviStore names stay.

## 6. Action items (in execution order)

**Step 0 — Confirm.** Final spelling; whether to rename the `~/diva` directory (and whether to use the transition symlink).

**Step 1 — Live/public surface first (Divilovescan).**
- Rename `src/pages/DivaBlocks.tsx → DivinaBlocks.tsx` and `functions/api/diva.ts → divina.ts`; update imports/routes in `App.tsx`, `api.ts`, `theme.css`.
- Rename the Cloudflare secret `DIVA_ORIGIN → DIVINA_ORIGIN` (update it in the Cloudflare dashboard too, not only in code).
- Pushing to main auto-deploys, so the public "DIVA" toggle becomes "DIVINA." Do this as one coordinated commit.

**Step 2 — Internal docs (safe, highest volume).**
- DD69 `docs/`: rename the 10 `DIVA-*.md` / `DIVI-DIVA-*.md` files and update DIVA inside all 11, including `DIVA-INDEX.md` cross-links; fix the whitepaper's "keep on-disk DIVA" note since the premise changed.
- `~/diva` plan docs: `PLAN.md`, `BRIDGE_PLAN.md`, `NFT_BRIDGE_PLAN.md`, `STORAGE_PLAN.md`, `DEPLOYMENTS.md`.
- `Divi-Blockchain_6.9`: `OVERLAY-ROADMAP.md`, `NFD-REGISTRY-ROOT.md` prose ("DIVA lane"→"DIVINA lane"), and the one comment in `contrib/dvxp-scan/src/registry.rs`.

**Step 3 — Code, scripts, and file/dir names in `~/diva`.**
- Rename scripts `run-diva-dev.sh`, `diva-up.sh`, `diva-heartbeat.sh`, `diva-rpc-proxy.mjs` → `divina-*`; fix their internal path/variable references.
- Rename `genesis/diva-genesis.json → divina-genesis.json`; update every script that points at it.
- Rename the Solidity source `bridge/contracts/DivaNFT.sol → DivinaNFT.sol` and the `DivaNFT` / `DivaNFTFactory` contract identifiers; update references in `redeploy-all.sh`, the test scripts, and the storage contracts.
- **Regenerate, do not hand-edit, the build artifacts** in `bridge/build/` (`DivaNFT.abi/.bin`, etc. are compiler output).
- The live socket `diva.ipc` and the devnet data dir `divadata/` are node-generated: point the config at new names and let them regenerate; the devnet data is throwaway.

**Step 4 — Memory (Claude's).**
- Rename `project_divi_diva_sidechain.md`; fix its `MEMORY.md` index line and any `[[links]]`; update DIVA mentions and cited paths across the DIVA-related memory notes.

**Step 5 — Things grep cannot see (manual, Geoff's call).**
- Any **logo/graphic** containing "DIVA" text (redesign, not a text replace).
- Any external marketing, social handles, or slide decks off this machine.

**Step 6 — Verify after.**
- Residual check: zero "diva" (any case) left in our files (excluding the upstream trees).
- Safety check: counts of DiviStore / DiviGo / divid69 are **unchanged** before vs after (proves no "Divi" word was mangled).
- Rebuild the bridge contracts; restart the node on the renamed config; load the explorer; confirm everything still runs.
- Commit per-repo on a branch so each surface is reviewable and reversible.

---

### One-paragraph summary

Rename DIVA → DIVINA across ~554 occurrences in ~37 files in four areas (DD69 docs, the `~/diva` workspace, the live Divilovescan explorer, and a few Divi-Blockchain docs), plus file/dir names. The vendored chain clients need no edits (their "diva" hits are coincidental). Use a case-aware, literal, scoped replace (`DIVA/Diva/diva → DIVINA/Divina/divina`) that cannot touch "Divi"/DiviStore, do the live explorer first and as one coordinated deploy, rename files/dirs with git, regenerate build artifacts and devnet data, and verify by checking zero residual "diva" and unchanged "Divi" counts. Chain id 1838 stays. Nothing is executed until Geoff says go.
