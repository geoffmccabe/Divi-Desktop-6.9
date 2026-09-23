# Why reconnecting looks slow, and how to make it feel instant

Written 2026-Sep-23 from the code and from the node's own log of last
night's restart. Analysis only; nothing here is built yet.

## What actually happens, with times

Measured on Geoff's Mac, node restart at 02:18:56:

| Step | Time | Who |
|---|---|---|
| Node process starts, opens its databases | 0 s | node |
| "Loading block index" (4.2 M blocks) | 0 to 69 s | node |
| Wallet load, verify last 100 blocks | 69 to 81 s | node |
| "Done loading"; P2P starts | 81 s | node |
| 24 peers connected | 81 to 111 s (24 in the first 30 s) | node |
| Wallet's peer poll notices (every 10 s) | +0 to 10 s | app |
| First probe wave allowed (8 s after first peer seen) | +8 s | app |
| Probe wave runs: every known address (~600), 64 at a time, 3 s wait for nodes believed alive, 8 s for doubtful ones, 12 s for written-off ones on their daily recheck | 5 s on a good day, up to ~75 s when the daily recheck of ~400 dead addresses lands | app |
| Results applied ALL AT ONCE when the slowest probe finishes | end of wave | app |
| Nodes light up on the map | ~100 s after the node started at best; ~3 minutes at worst | |

So the network itself reconnects in seconds. The wait is made of three
things, all ours:

1. **The node's own load (81 s).** Sixty-nine seconds of that is reading the
   block index from disk. Nothing the map can do about it, but the map does
   not have to wait for it either (see below).
2. **The map starts from zero every time.** It remembers which nodes were
   alive yesterday (`dd69.probeRecords.v1`) and uses that only to decide how
   patiently to ask, never to draw. Until the first probe answers, a node
   the app has seen alive every day for a month is drawn as "seeking" and
   not counted. Worse: if the app is reopened within 60 seconds, those nodes
   are "not due" for a probe, so they are neither probed nor shown alive for
   up to a minute.
3. **All-or-nothing waves.** The probe results are applied only when the
   whole wave finishes, so 100 nodes that answered in 200 ms wait for the one
   dead address that takes 12 seconds to time out. And on the day the daily
   recheck of written-off addresses comes due, that one wave is ~400 slow
   probes and the map sits still for over a minute.

## What "optimistic" can mean here, honestly

Geoff's instinct is right and it is standard practice (it is how phones show
Wi-Fi as connected before the DHCP dance finishes). The rules that keep it
honest:

- **Draw from memory first, verify second.** On open, every node that
  answered within the last day is drawn as alive immediately and counted,
  marked internally as "assumed". They keep that look unless a probe fails
  three times (the existing three-miss rule), at which point they go grey
  the same way they do today. Nothing new is invented; the old evidence is
  simply trusted until contradicted.
- **Apply answers as they arrive, not when the wave ends.** Each probe answer
  updates its own node the moment it comes back. The 200 ms answers show in
  200 ms. This is a change inside the probe call (stream results) and the
  handler (per-node update), not a change of rule.
- **Ask the recent peers first, and right away.** The node's last peer list
  (the app already has it from the previous session) goes out as the first,
  tiny wave with no 8-second delay and no "wait for a peer" gate, the moment
  the map opens. Twenty addresses, 64 workers: done in under a second for
  the ones that are up.
- **Never let the daily recheck block the live wave.** Written-off addresses
  are rechecked in their own slow lane (a few at a time in the background),
  never in the same wave as the nodes people are looking at.
- **Do not wait for the node to load to show the network.** The probes come
  from the app, not from the node; the map can show the network alive while
  the node is still reading its block index, with the node's own pin
  showing "starting". Today the wave is gated on the node reporting at least
  one peer, which is the 81-second load plus a poll.

## What is NOT possible

- The node's P2P handshake cannot be sped up from the app; but it is already
  fast (24 peers in 30 s once loaded), so it is not the problem.
- The 69-second block-index load is the node reading 4.2 M block headers from
  disk. A faster disk helps; a smaller index does not exist for this chain.
  The pruned/snapshot work does not change it.

## Expected result if all five are done

- App reopened: the map is fully drawn from memory in the first frame,
  counted, with the recent peers confirmed within about one second and the
  rest of the alive set confirmed over the next few seconds as answers
  stream in. Nodes that have gone away fade out over the following minute.
- Node restart while the app is open: the map does not go blank; the node's
  own pin shows "starting" for ~80 s and the rest of the network stays lit.

## Cost and risk

Five contained changes in `ui/src/wallet/NetworkMap.tsx`,
`ui/src/wallet/probeSchedule.ts` and the probe command in
`crates/app/src/main.rs` / `crates/supervisor/src/network.rs`. The rules in
`probeSchedule.ts` are pure and tested, so "assumed alive" and "answers as
they arrive" can be tested without the app. Risk: an address that died
overnight is shown alive for up to three probes (about two minutes) before
it goes grey. That is the price of optimism, and it is the same price the
count already pays for an "unsure" node.
