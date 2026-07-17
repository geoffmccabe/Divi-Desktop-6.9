# Divi Desktop 6.9 — Build Plan

A ground-up replacement for Divi Desktop (the abandoned Electron/Angular wallet), built as a
Tauri app: a **Rust core** that supervises a real `divid` full node, under a **React UI** in the
Kinet.ink design language (animated hex-grid backdrop, deep indigo gradient, frosted-glass panels).

Repo: `geoffmccabe/Divi-Desktop-6.9` · Plan owner: Geoff McCabe (Divi founder / former CEO)

---

## Why rebuild (measured, not guessed)

Diagnosed on a real machine running Divi Desktop 2.0 (2026-Jul):

| Problem | Evidence |
|---|---|
| Runs under Rosetta on Apple Silicon | App binary is `x86_64` only; no arm64 build exists |
| Corruption on shutdown | Daemon needs **9–13 s** to flush (`PrepareShutdown → MainShutdown` in debug.log); the old wallet kills it mid-flush when the OS shuts down |
| Slow startup | 38–64 s just to load the block index; plus a **147 MB** wallet backup copied on *every launch* |
| Backup bloat | 40 × 147 MB backup copies (5.7 GB) stored **inside** the datadir they back up |
| No/wrong messaging | Users never know what the node is doing or why staking is off |

Key facts in our favor:
- Full node is only **~9 GB** (vs Bitcoin's ~700 GB) — genuinely shippable to a desktop.
- **Official snapshot is alive and rebuilt daily**: `https://snapshots.diviproject.org/dist/DIVI-snapshot.tar.gz` (~4.4 GB). Used for first-run sync AND corruption recovery. Verify a checksum on download.
- Divi Core **has BIP39/HD seeds** (`bip39.cpp`, `hdchain.cpp`); modern wallets are HD (`m/44'/301'/...`) — backups can be 24 words.
- The daemon logs `LoadBlockIndexState: Last shutdown was prepared: true/false` — a free, reliable dirty-start detector.
- `getstakingstatus` returns every reason staking might be off — the messaging layer maps each to a human sentence.
- `divid` runs on arm64 Macs today via Rosetta, so a native arm64 build is a **performance upgrade, not a gate**.

## Architecture

1. **Rust core (Tauri)** — node supervisor, RPC client, recovery, OS keychain. All crash-proofing lives here.
2. **React UI (webview)** — Kinet.ink components (`AnimatedBackdrop`, frosted panels) port over nearly as-is.
3. **`divid`** — real full node, managed child process. Never killed; always asked to stop, then waited for.
4. **Remote services (strictly optional at runtime)** — Kinet.ink AI-character chat, LW-SSO login, snapshot CDN.
   **Hard rule: the wallet and funds fully work offline / with every remote service down.**

## The supervisor (the actual product)

- **Clean shutdown, always**: issue `stop`, wait for exit. Intercept OS shutdown on all three platforms
  (macOS termination delay; Windows shutdown-block with on-screen reason "Divi is safely closing the
  blockchain database"; Linux SIGTERM handler + inhibitor). We need to buy ~15 s.
- **Dirty-start detection** via the daemon's own "Last shutdown was prepared" flag.
- **Recovery ladder (automatic)**: ① rebuild chainstate from local blocks → ② restore from the daily
  snapshot → ③ full reindex. Every rung shows: *"Your coins are safe. Only downloaded data is being repaired."*
- **Backups done right**: wallet.dat copies are bounded, rotated, and stored **outside** the datadir; not
  copied on every launch. New wallets: HD, 24-word phrase shown once at creation (never stored by us).
  Legacy-wallet migration flow (sweep to fresh HD wallet) kept as an edge-case tool.
  Open question for Phase 1: does Divi Core expose a "reveal seed phrase" RPC for existing HD wallets
  (`rpcdump.cpp`)? If yes, add "View recovery phrase"; needs unlocked wallet.

## Messaging

One explicit state machine, its current state always visible as a human sentence:
`Starting node → Finding peers (n) → Syncing (x/y, ETA) → Synced → Staking` / or exactly why not
(wallet locked / coins immature / no connections / not synced — each with a fix button where possible)
`→ Shutting down safely (don't force quit) → Repairing (your coins are safe)`.
**No raw daemon error ever reaches the user.**

## Wallet features

Send (fee preview, address validation before anything irreversible) · Receive (QR, new-address) ·
Address book with labels · Activity feed · Staking panel with "why not" explanations ·
**CLI console** — an RPC console pane; destructive commands gated behind confirm; autocomplete
dictionary seeded from the old repo's `divi-cli-commands.txt`.

## AI character (Kinet.ink embed)

Wide window; the character stands to the right, overlapping the wallet panel, with a
"Chat with me about Divi" bubble. Clicking swaps the panel to a Kinet.ink chat iframe (RAG-trained
by Geoff with Divi/DiviGo knowledge). Wallet-grade deltas vs the SSO reference implementation:
- **Exact** postMessage origin equality both directions (no `includes()`, no `'*'`).
- Identity display fields only through the bridge — **never balances, addresses, keys, or tokens**.
- Only the **public** chat key ships in the app; the **admin key and training screen live in Geoff's
  admin infra, never in the wallet binary**.
- Embed host comes from a small remote config (it was renamed once before; a hardcoded host in a
  shipped binary is a permanent break).
- Character PNG bundled locally (remote override allowed); desktop hidden below ~1024 px width.

## LW-SSO login (optional identity, never access)

Loopback flow only: throwaway HTTP server on `127.0.0.1:<random>`, system browser (never an embedded
webview) to `sso.lightningworks.io/login?app=divi-wallet&redirect=http://localhost:PORT/callback`.
Tokens arrive in the **hash fragment** → serve a bridge page that forwards them to a second local
endpoint. One callback, then shut down; ~2-minute timeout. Verify via `POST /api/verify` (never trust
the JWT locally). Tokens in the OS keychain. SSO personalizes chat identity and profile; **funds and
wallet functions never depend on it**.
- Geoff registers the app in the SSO admin (slug `divi-wallet`) + Divi branding.
- Known-stale doc: `sso/docs/tauri-launcher-sso-integration.md` "Option B" (custom protocol) cannot
  work against the current allowlist — fix when this phase starts.

## Phases & gates

| # | Phase | Gate |
|---|---|---|
| 1 | Supervisor, headless (start/stop/recover the node) | Survives automated kill-and-corrupt torture tests |
| 2 | State machine + messaging catalogue | Every state → correct human sentence |
| 3 | UI shell (Kinet.ink look, wide layout, status line) | Geoff approves the look |
| 4 | Send / receive / addresses / activity | Real transactions verified |
| 5 | Staking + HD seed creation (+ legacy migration tool) | Staking explains itself; new-wallet seed flow works |
| 6 | CLI console | — |
| 7 | AI character embed + training pass | Character answers Divi questions correctly |
| 8 | LW-SSO login | Round-trip on all three platforms |
| 9 | Native arm64 `divid` build | Beats the measured 38–64 s startup |
| 10 | Signing, notarization, installers, auto-update (app **and** daemon) | Clean install on a fresh machine |

Phases 7–9 are deliberately late — additive; nothing above depends on them.

**Geoff-only tasks:** character art + Divi knowledge text (≤1M chars), Kinet.ink keys, SSO app
registration, Apple Developer + Windows signing accounts.
