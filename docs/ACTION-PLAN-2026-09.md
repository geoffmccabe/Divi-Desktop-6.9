# DD69 action plan: everything started and not finished

Written 2026-Sep-22 from Geoff's testing, every plan document in `docs/`,
the game code, and the last eighty commits. Grouped by what the user sees,
ordered within each group by how much it matters. Each item says what is
wrong, what the code actually shows, and what "done" means.

Plain rule for working this list: **one group at a time, test on a real
machine, publish, then the next.** No more one-fix-one-release.

---

## A. Things Geoff hit today (fix first)

### A1. No sound in the game
Cause found. Every game sound checks the theme's Volume setting and returns
silently if it is zero; there is no other mute anywhere. Also, the game
resumes a *suspended* audio engine but not an *interrupted* one, which is
WebKit's state after a phone call, a sleep, or another app taking audio,
and which never recovers on its own.
Done when: the Volume slider cannot silence the game to zero without saying
so on the game screen; an interrupted engine is restarted; a sound test
button in the game HUD proves it.

### A2. No enemies at all
Cause found, and it is structural. Enemies spawn in exactly two places: on
the multiplayer server, or locally when you are at Spikeworld. Anywhere
else, if the socket to the room is not live, the sky is drawn empty. So a
dropped or blocked connection to `divi-rebels-room.geoff-de3.workers.dev`
means no fighters, no waves, no flocks, with no message. At Spikeworld the
only enemies are the sixty heart guards, sent once.
Done when: the game spawns enemies locally whenever the room is not live
(the code for this exists; it is only called at Spikeworld), and the HUD
says plainly "offline, flying alone" when the room is unreachable.

### A3. Map popups appear over the game
Cause found. The map's hover tooltip, right-click menu and "gone quiet"
banner are not told the game is running; only the play button and the
scroll wheel are. Moving the mouse while flying pops node tooltips;
right-click opens the node menu; a quiet node paints a banner across the
cockpit.
Done when: while the game is active, none of those render and the map's
mouse handlers are detached.

### A4. Heart has no million counter
The counter exists (a million hit points, a bar, damage applied) but two
things are missing: the number itself is not shown, and reaching zero has
no outcome, which the code says outright ("cannot be killed yet").
Done when: the remaining hit points are shown as a number that ticks down
with every hit, and zero does something.

### A5. Torpedoes don't fire at Spikeworld
Two candidates in the code, not yet proven which: the rear-fire path needs
torpedoes in stock (zero stock means nothing happens with no message), and
the forward path needs the secondary slot to be one that is "fitted"; beam,
mine and bomb are marked not fitted. Either way the failure is silent.
Done when: a torpedo press with no stock says "no torpedoes", a press on an
unfitted weapon says so, and torpedoes fire at Spikeworld in a real test.
Plus the one open item from the Spikeworld plan: flocks do not split away
from a torpedo (never built).

### A6. Charts in the hamburger menu
Five entries say "not built yet": Market Cap, Wallets Holding DIVI, New
Wallets per Day, Nodes on the Network, Transactions per Day. The plan is in
`CHARTS-PLAN.md`; the data for three of them already exists on the scanner
box; nodes-over-time exists nowhere and must start being recorded
(Phase 0 there, still not started, losing a day of history each day).
Done when: all five draw real data, and a daily node snapshot has been
running for at least a week.

---

## B. The node and wallet core (the Bug Hell analysis)

### B1. The Node Supervisor: not started
Step 1 (the Windows test gate) is done. Step 2 (the yes/no/don't-know
answer type) and step 3 (one owner for starting, stopping, judging and
repairing the node, managing several nodes for DIVA) are not started. This
is the reason "gone quiet while starting" and its cousins keep appearing.
Done when: bring-up, watchdog, snapshot and quit all go through one
supervisor, the UI reads one status object instead of fifteen pollers, and
the incident comments are moved to a postmortems file.

### B2. Two-factor (2FA)
A panel that says "not built". Decision needed: which actions it guards.
Done when: an authenticator-app code is asked for before the chosen actions.

### B3. "Live of known" node count
The count now means "verified alive". Decide whether to show "113 live of
400 known".

### B4. Security wording names the node
Every Security panel should say which node's wallet it is about, in the
shape Geoff approved. Partly done (the header line); the Password panel's
body text still says "your wallet".

### B5. My Nodes card
Replace "Host" and "RPC user" with reachable / synced / block / staking /
peers / country; plumbing behind a "details" toggle. Retire the old "DD69
running here" indicator in favour of the hearts.

### B6. Restore from seed: first real test
Built today, both paths; the "second node" path has been tested in pieces,
not end to end on a real machine.

---

## C. Divi Rebels: game features started and dropped

- **Paying in DIVI in the Armoury is not wired.** Price shown, grant code
  exists, button unconnected.
- **Cash out**: the London payout service that signs and sends DIVI is not
  built; the CASH IN DIVI button and low-balance banner are not built;
  "awaiting first real payout".
- **Items tab** is a placeholder; mine and bomb are still frames; selling a
  ship with its guns.
- **Local Portals** (Items plan Phase 5) not built.
- **Enemies aim at ships rather than choosing wingmen** (Items plan, noted
  not done).
- **Spikeworld plan**: Phase 2 (on screen/reachable), 4 (spikes, spokes,
  heart), 5 (collision), 5a (the gate and the sky), 6 (making it a place)
  have no commits; "how big the rooms are" undecided.
- **Multiplayer, six "not right yet" items**: gear is the client's word;
  flocks are not in the room; peers cost 5-15 draw calls each with no LOD;
  identity is the connecting address, not wallet-signed; one room only, no
  regions; no reconnect resume.
- **Network plan** Phases 3-8 (delta snapshots, binary wire, smoothing,
  sequence numbers, shard per planet, bandwidth budget) not started.
- **Web version** stops at Stage B1 (deployed 2026-Sep-13); B2 sign-in, B3
  divi.love/rebels, B4 scanner tower, B5 launch checks open; "not yet seen:
  flying, sound and frame rate in a real browser". Mobile web not built.
- **Music**: one flying track; no separate music volume.
- **Globe**: NASA 500 m tile swap not done; neighbour-tile prefetch not done.
- **Orbit spec**: scoped, nothing built. **Shared core plan** Stage C (phone
  door): nothing built. **Controls proposal**: nothing built.
- **Modular game**: the package move has not started; G4 and G7 unrecorded.
- **Ship market Phase 5** (flying what you bought): not built.

## D. Wallet panels that are placeholders

- **DMT tokens**: the whole panel runs on a stub; balances are deliberately
  fake; sending is blocked. The index is not built.
- **Governance**: a non-functional walkthrough; no voting, proposals or
  tallies.
- **Market maker panel**: "coming soon" walkthrough.
- **Agent panel**: first placeholder pass; CHAT and STATS "coming soon".
- **Pin Code incoming alert**: a stub; nothing to detect until Pin Code
  Send has its on-chain form.
- **Lottery filter** in Activity: disabled, "coming soon".
- **Install panel**: two options greyed "coming soon".
- **Multisig**: works, but blobs are passed by copy/paste (no PSBT).
- **NFD storage**: defaults to the local stub; the real Arweave relay is
  not wired (NFD creation blocked on it).
- **Node identity service**: code complete, not deployed; the map, chat,
  credits and autonomy phases not started.
- **Human-readable addresses**: BUY, expiry/release auction, phone records,
  and send-box name resolution ("the highest-value remaining piece") not
  built.
- **Payments**: subscriptions designed not built; CANCEL and RECEIPT
  subtypes specified not built.
- **Proof of existence**: native index and record validation not built.
- **Map animation**: `tx.send` and `stake.win` events in the catalog but
  nothing emits them.
- **Contacts**: Agents and Bots contact types on the roadmap, not built.

## E. Chain and infrastructure

- **DIVA**: Phase 2 POAS consensus not built; Phase 4 checkpointing not
  built; the peg unproven; the build still carries a superseded two-coin
  model. The two base servers are ready for it.
- **NFD to DIVA bridge** Phase 2 gated on DIVA POAS.
- **Community apps**: Block A shipped, awaiting Geoff's pass; Blocks B, C, D
  not started; ten open decisions.
- **UK box**: 4 GB memory, cannot host DIVA; upgrade or replace with the
  build script. Scanner jobs have no committed schedule.
- **Yasmin's node**: Europe box synced and named; her wallet restore
  (ordinary staking, by her hand) not done.
- **Andy's node**: still on 69.0.2; shows as a heart once he updates.
- **Snapshot**: mirrored and verified; generating our own rather than
  mirroring, later.
- **Three feature branches** (map-animation-v2, divi-rebels, rebels-web)
  merge from integration repeatedly and never merge back; there must be one
  branch that ships.

---

## Suggested order

1. **A1-A5** (the game as Geoff plays it today), one release.
2. **A6 charts** with the node snapshot started first, since it loses data.
3. **B1 the supervisor**, uninterrupted. Nothing else in the node code
   until it is done.
4. **B4, B5, B2** (Security wording, node card, 2FA).
5. Then C and D by whatever Geoff wants users to see first; my suggestion is
   Armoury payment and cash-out, because they touch real money the game
   already promises.
