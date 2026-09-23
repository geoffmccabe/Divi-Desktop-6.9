# Plan: make the network map reconnect (nearly) instantly

Written 2026-Sep-23. Companion to `RECONNECT-ANALYSIS-2026-09.md`, which
has the measurements. This is the build plan; nothing here is built yet.

## The goal, as a number

Today, after opening the app with the node already running, the map takes
10 to 40 seconds to show the verified network and up to a minute more to
finish animating it; after a node restart, add 80 seconds. The target:

- **App reopen:** the whole remembered network is drawn and counted in the
  first frame; the recent peers are confirmed within 1 second; the rest of
  the alive set is confirmed within 5 seconds; nothing that was already
  drawn flickers or re-animates.
- **Node restart while the app is open:** the network stays lit throughout;
  only our own pin shows "starting"; peer lines return within one poll of
  the node finishing its load.

And the target is MEASURED, not eyeballed: the app writes a "reconnect
stopwatch" into the setup log (step 0 below), so Geoff's own machine reports
whether the target was met.

## Principles

1. Old evidence is trusted until contradicted. A node that answered within
   the last day is alive until it misses three probes, exactly the existing
   three-miss rule, applied from the first frame instead of from the first
   wave.
2. Every answer is applied the moment it arrives. No waiting for the
   slowest probe in a wave.
3. What the player is looking at is never held up by housekeeping. The
   daily recheck of dead addresses runs in its own slow lane.
4. The map does not wait for the node. Probes come from the app.
5. Nothing that has not changed is animated.

## The steps, in order

Each step is one release, testable on its own, and leaves the app no worse
if the next step never comes. Steps 1 to 4 are pure map/scheduler work in
TypeScript; step 5 touches Rust; step 6 is cleanup.

### Step 0. The reconnect stopwatch (measurement first)

What: when the map mounts, note the time. Write one setup-log line at each
milestone: first peer shown, 50% of yesterday's alive set confirmed, 90%
confirmed, first wave finished, animation finished. Format:
`map: reconnect +0.8s first peer, +1.2s 50% confirmed (57 of 113), +4.1s 90%, +6.0s wave done, +6.4s drawn`.
Also record it in the game's black box (`dd69.rebels.diag`) so
`scripts/read-rebels-diag.sh` shows it.

Files: `ui/src/wallet/NetworkMap.tsx` (milestones), `ui/src/wallet/
reconnectClock.ts` (new, pure: takes timestamps and the alive set, produces
the line; unit-tested), the existing `setup_log` command in
`crates/app/src/main.rs` (already exists for the copy button; add a small
"append a line" command).

Done when: Geoff's setup log after an app open contains that line. This
step ships FIRST so every later step has a before/after number.

### Step 1. Draw from memory: assumed-alive

What: at mount, every node whose record says it answered within the last
24 hours and is not "down" is drawn as alive and counted, with an internal
"assumed" flag. The tooltip says "last confirmed N minutes ago" until the
first probe confirms it, then it is an ordinary alive node. Three misses
send it grey exactly as today.

The one line that forces everything to "offline" at mount
(`NetworkMap.tsx`, the "dim ghosts" rule) becomes: offline only if the
record says down or never answered; otherwise assumed-alive.

The "not due within 60 s" trap goes: on mount, every assumed node is due
now (the first wave confirms what memory drew).

Rules live in `ui/src/wallet/probeSchedule.ts`:
`assumedAlive(record, now)` and a new liveness for the drawing code,
`"assumed"`, which counts like alive and draws like alive.

Tests (`probeSchedule.test.ts`): alive 2 h ago → assumed; alive 3 days ago
→ not; down → not; assumed then 3 misses → down; assumed then answer →
alive; assumed nodes are all due at mount.

Done when: stopwatch shows the count in the first frame equal to
yesterday's count (plus or minus the nodes that really changed).

### Step 2. Recent peers first, instantly

What: cache the live peer list (`dd69.lastPeers.<scope>`, saved every
poll). At mount, before anything else, send ONE small wave: the cached
peers plus the 40 most recently confirmed nodes, 1.5-second timeout, no
8-second delay, no "node must have a peer" gate. Peer lines are drawn from
the cached list at once, marked assumed, and replaced by the real list on
the first poll.

Files: `NetworkMap.tsx` (mount sequence), `knownPeers.ts` (peer cache next
to the known-node store), `probeSchedule.ts` (`firstWave(records,
cachedPeers, now)` picks the set; tested).

Done when: stopwatch "first peer" and "50% confirmed" are both under 2 s on
Geoff's Mac.

### Step 3. Answers as they arrive, and the animation only for changes

What (two halves, same step because they share the handler):

a. Split the main wave into chunks of 48 addresses and issue them as
   separate calls; each chunk's answers are applied when that chunk
   returns. The Rust probe already runs 64 workers per call; with chunks of
   48 issued four at a time the thread count stays under 200 and a chunk of
   live nodes returns in well under a second. (Step 5 replaces this with
   true streaming; chunks are the version that needs no Rust change.)

b. The probe animation (`mapEvents.ts`, `beginProbeWave`) receives only the
   nodes whose state CHANGED (assumed→confirmed is not a change; alive→
   missed, unsure→alive, new node are). The per-node stagger is capped so a
   whole wave finishes animating within 3 seconds
   (`stepMs = min(90, 3000 / targets)`), and the arc/ring is skipped for
   confirmations.

Files: `NetworkMap.tsx`, `mapEvents.ts`, `probeSchedule.ts`
(`chunks(list, 48)` and `changed(before, after)` helpers, tested).

Done when: stopwatch "90% confirmed" under 5 s and "drawn" within 3 s of
"wave done".

### Step 4. The slow lane

What: addresses written off ("down") are never in the main wave. A
separate timer takes up to 16 due rechecks every 60 s, 12-second timeout,
one call, and applies results the same way. The main wave asks only alive,
assumed and unsure nodes, 3 s (alive/assumed) and 8 s (unsure) as today.

Also: the main wave no longer requires the node to report a peer, and it
runs on the map's own clock (first wave at mount per step 2, then every 60
s). The node's own pin follows the node phase as today.

Files: `probeSchedule.ts` (`plan()` returns three lanes: quick, patient,
recheck; the recheck lane is paced), `NetworkMap.tsx` (second timer).

Tests: a day's worth of simulated ticks: the recheck lane never exceeds 16
per minute, never delays the quick lane, and every down node is still asked
within 24 h.

Done when: on the day the daily recheck lands, the stopwatch numbers are
unchanged.

### Step 5. True streaming from Rust (optional, after 1 to 4 are measured)

What: `probe_peers` emits one Tauri event per answer (`dd69://probe`, with
ip, online, milliseconds) as each worker finishes, and still returns the
full list at the end. The map applies events as they come; the chunking
from step 3 goes away. Also record the round-trip time per node (the map's
"ping" already exists for the right-click menu; this makes it free).

Files: `crates/supervisor/src/network.rs` (a callback per result),
`crates/app/src/main.rs` (emit), `ui/src/wallet/api.ts` + `NetworkMap.tsx`
(listen).

Done when: "90% confirmed" is within 1 s of the 90th-percentile round-trip
time to those nodes (i.e. the map is as fast as the network).

### Step 6. Cleanup

Remove the chunking, the old "first probe 8 s after first peer" gate, the
`instantReveal` special case, and the comments that described the old
behaviour. Update `docs/ACTION-PLAN-2026-09.md`.

## What does not change

- The three-miss rule and the 24-hour recheck of dead addresses.
- The node's own bring-up, watchdog and phases.
- The count's meaning (verified alive; assumed counts as alive because it
  was verified within a day).
- The look of the map: same colours, same arcs; there are simply fewer of
  them and they finish sooner.

## Risks, and what is done about them

- **A node that died overnight shows alive for ~2 minutes** (three probes).
  Accepted; it is what "unsure" already costs. The tooltip says "last
  confirmed 9 h ago" so the truth is one hover away.
- **Thread count** (step 3 chunks): four concurrent calls of 64 workers is
  256 threads for a few seconds. Bounded, and gone in step 5.
- **A machine that was asleep**: the wall clock jumps, so "alive 2 h ago"
  may be "alive 9 h ago" on wake. The 24-hour window covers it; the first
  wave on wake confirms or greys within a minute (the visibility handler
  already forces a poll on wake; it will also force the first wave).
- **Storage**: the peer cache is one small list per node profile.

## Order of work and releases

1. Step 0 (stopwatch) alone: one release, so there is a baseline number
   from Geoff's machine before anything changes.
2. Steps 1 + 2 together: the "instant" release.
3. Steps 3 + 4 together: the "smooth" release.
4. Step 5 if the numbers say the chunking is the remaining gap.
5. Step 6.

Each release: full voxel/rebels/probe test suites, `tsc`, then
`scripts/publish-release.sh`.
