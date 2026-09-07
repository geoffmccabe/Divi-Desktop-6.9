# Divi Rebels: the room

A Cloudflare Worker with one Durable Object per shared world. It exists for one
reason: **so that kills are counted by something the player cannot edit.**

Everything the game currently knows about a player's score comes from the
player's own machine. That is fine for a leaderboard nobody is paid for, and it
is a faucet the moment DIVI is attached to it. So the order of work is fixed:
the room counts first, the payout comes after, and never the other way round.

## What the room owns

* **The waves.** When they start, how many, and how hard.
* **The fighters.** Where they spawn, how they fly, when they shoot.
* **Every bullet**, including the ones players fire. A client says "I pulled the
  trigger, here, pointing there". It does not say what it hit.
* **Hits, kills, coins, score and DIVI.**

## What a client owns

Its own ship's position, which it reports. That is the one thing taken on trust
in this version, and it is bounded: a report that moves further than the ship
can physically fly since the last one is rejected and the player is snapped
back. Server-authoritative player movement is the harder half and comes later;
DreadRoot's audit is explicit that doing it before the fundamentals is what
sinks these projects, and the fundamentals here are the fighters and the hits.

## What "anti-cheat" means here

* **Encryption is not the defence.** The connection is wss, which stops third
  parties reading it. The threat is the player, and the only answer to that is
  the server owning the simulation.
* **No client-reported outcomes.** Not kills, not damage, not score, not coins.
* **Rate limits** on every message, checked against what the game physically
  allows: a trigger that fires faster than the guns can, or a transform arriving
  faster than the tick, is a disconnect rather than a shrug.
* **Identity is the node.** Signing in with a Divi address, and running a node,
  raises the cost of an attack. It does not prevent one: if the prize is real
  money, standing up a node is a morning's work. Per-node caps still matter.
