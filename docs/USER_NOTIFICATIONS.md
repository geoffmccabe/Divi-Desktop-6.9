# DD69 — Suggested User Notifications (catalog for later placement)

Purpose: a menu of candidate user-facing messages for every meaningful state and
event, so that once the logging + stability work is solid we can decide which to
surface and where. **Placement is NOT decided here.** Each item lists: when it
fires, suggested wording, and candidate placements. Placement options are:

- **modal** — centered card (blocks or overlays the app)
- **top-center** — a thin banner across the top middle
- **bottom-left** — the existing node-status corner
- **inline** — within the relevant panel (e.g. the staking area)
- **silent/log-only** — no UI, log only

We will later pick one (or none) per item. Nothing here is a commitment to build.

---

## 1. Startup & database

| # | Fires when | Suggested wording | Candidate placement |
|---|---|---|---|
| 1.1 | App opens, node being started | "Starting the Divi node…" | top-center / bottom-left |
| 1.2 | Node loading its database | "Loading the blockchain (this can take a minute)…" | top-center / bottom-left |
| 1.3 | Database integrity check running | "Checking the blockchain database…" | bottom-left / silent |
| 1.4 | Database check passed | (none — proceed silently) | silent/log-only |
| 1.5 | Database found damaged | "The blockchain database needs repair. Repairing now — this can take a few minutes." | **modal** / top-center |
| 1.6 | Repair in progress | "Repairing the blockchain database… {percent}% ({blocks} processed)" | modal (with progress) |
| 1.7 | Repair finished | "Database repaired. Continuing…" | top-center / silent |
| 1.8 | Repair failed | "The database couldn't be repaired automatically. {detail} — you can copy the logs from Settings → Logs." | **modal** |

## 2. Network & sync

| # | Fires when | Suggested wording | Candidate placement |
|---|---|---|---|
| 2.1 | No internet / can't reach network | "No internet connection — the Divi node can't reach the network. Retrying…" | top-center / bottom-left |
| 2.2 | Connecting / finding peers | "Connecting to the Divi network… ({count} peers)" | bottom-left (count climbs) |
| 2.3 | Syncing behind the tip | "Catching up on the blockchain — block {height} of {tip} ({percent}%)" | top-center / bottom-left |
| 2.4 | Fully synced | "Up to date." | bottom-left / silent |
| 2.5 | Taking unusually long AND making no progress | "Still working — no new blocks yet. Your connection looks slow or the network is quiet." | top-center (only when genuinely stalled, not on a timer) |

*Note: 2.5 should be tied to "no measurable progress," never a fixed timer — a
long-but-progressing sync must not be flagged as a problem.*

## 3. Wallet & staking

| # | Fires when | Suggested wording | Candidate placement |
|---|---|---|---|
| 3.1 | Synced, wallet locked, not staking | "Ready to stake — unlock your wallet to begin." | inline (staking area) |
| 3.2 | Unlock succeeded, staking on | "Staking is on." | inline / bottom-left |
| 3.3 | Staking active summary | "Staking — {balance} DIVI working." | inline |
| 3.4 | Unlock failed (wrong password) | "That password didn't unlock the wallet. Try again." | inline / modal |
| 3.5 | Not enough mature coins to stake | "Staking is on, but your coins are still maturing — this is normal for new deposits." | inline |

## 4. Shutdown

| # | Fires when | Suggested wording | Candidate placement |
|---|---|---|---|
| 4.1 | App closing, waiting for node to save | "Safely shutting down the node… (don't force-quit)" | **modal** (brief) / top-center |
| 4.2 | Node confirmed clean shutdown | (none — app closes) | silent/log-only |
| 4.3 | Node slow to shut down | "Still saving the blockchain safely — a moment…" | modal |

## 5. Problems / errors

| # | Fires when | Suggested wording | Candidate placement |
|---|---|---|---|
| 5.1 | Node stopped unexpectedly | "The Divi node stopped. Restarting it…" | top-center |
| 5.2 | Node running but not answering the app | "The node is running but not responding to the app right now. Retrying… (your coins and staking are unaffected)" | top-center / bottom-left |
| 5.3 | Node won't start after repair attempts | "The node couldn't start. Please copy the logs from Settings → Logs so we can look." | **modal** |
| 5.4 | Any error surfaced to user | Always end with: "Details are in Settings → Logs (copy all)." | wherever the error shows |

---

## Cross-cutting wording principles
- Plain language, no jargon ("blockchain database," not "chainstate/LevelDB").
- Reassure when the engine is fine but the dashboard isn't (5.2): the user's coins
  and staking are never at risk from a display problem.
- Never imply a problem from elapsed time alone — only from a lack of *progress*.
- Every error message points the user to **Settings → Logs → Copy all**.
