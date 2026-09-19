# Divi Rebels: Orbit Mode

Multiplayer dogfighting over a mini-globe built from the real Divi node map,
where the live network is the weather.

Date: 2026-Sep-06. Repo: /Users/geoffreymccabe/Divi-Desktop-6.9.
Status: SCOPED, nothing built. The solo vector game (`io.divi.rebels`) is live
in v69.6.9.

---

## 1. The idea in one paragraph

The existing Node Map globe becomes a playable planet. Every real Divi node is a
tower you can see and fly to. You launch your fighter from your own node, fly
around a world about 400 game-metres around, and fight alongside everyone else
who is online. The links between towers already carry flowing hex characters:
those become real traffic, so when the chain relays a transaction you watch it
run between two towers, when somebody wins a stake the winning tower flares
gold, and when the weekly lottery draws the whole planet knows about it. Return
to your own tower to repair and rearm.

---

## 2. The decision that unblocks everything

**Orbit mode should be a wallet panel, not a sandboxed community app.**

The solo vector game lives in the sandbox and should stay there: it is the
showcase and the worked example. Orbit mode cannot, for two reasons that both
point the same way.

* **Network.** The app sandbox is `connect-src 'none'` (`APP_CSP` in
  `crates/supervisor/src/appbundle.rs`). A sandboxed app physically cannot open
  a socket. Multiplayer from inside it would need a brokered relay punched
  through the wallet's tightest security boundary, invented from scratch, for a
  game. As a wallet panel it needs one line: add the game server to
  `connect-src` in `crates/app/tauri.conf.json`, which is the same thing already
  done for `nodes.divi.love`.
* **Three.js.** The wallet already ships three 0.185 and react-globe.gl for the
  Node Map. A sandboxed app is a separate document and would have to carry its
  own copy, adding hundreds of kilobytes to the binary to draw the same globe
  twice.

So: Orbit mode is a panel that reuses `ui/src/wallet/GlobeMap.tsx`. The sandbox
stays sealed at `connect-src 'none'`, which is worth more than the tidiness of
having both modes in one place.

Where it appears: a **Play** button on the Node Map panel, and a nav entry. The
Community Apps card for Divi Rebels keeps launching the solo vector game.

---

## 3. The planet

### Scale

Geoff's ratio, 100 km to the metre, gives a planet **63.7 metres in radius** and
**400 metres around**. The globe engine already uses a radius of 100 units, and
that geometry fixes one unit at about **64 km of real Earth**, so the spec quotes
everything in globe units and the ratio comes out the same.

| | |
|---|---|
| Planet radius | 100 units (6371 km) |
| Circumference | 628 units (40,075 km) |
| Flight band | surface to +25 units above it |
| Tower height | 3 units today, proposed 4 to 6 for landmarks |
| London to New York | 87 units |
| London to Sydney | 267 units |

### Speed, and the honest trade-off

A mini-globe means everything is close, and no amount of tuning changes that.
The only real lever is speed, and it decides what kind of game this is.

* Proposed cruise **16 units/s**, boost **38 units/s**.
* Full orbit at cruise: about **40 seconds**. Boosting: about 17 seconds.
* London to New York: about **5 seconds**. Two nodes in the same city: under a
  second.

That makes the whole world reachable in well under a minute, which is right for
an arcade dogfight: nobody is ever out of the action, and returning to your
tower to rearm costs a real but not tedious few seconds. It also means flights
between neighbouring nodes are very short, and the fighting will naturally
happen in bubbles around tower clusters rather than during long transits. That
is a consequence of the mini-globe, not a bug, but it is worth knowing before
the art gets built. `SCALE` and `CRUISE` should be single constants so the feel
can be dialled in play rather than argued about now.

### Look

The Node Map currently wears a photographic night-Earth texture. A thin-line
vector fighter over a photo will clash badly. Proposal: Orbit mode swaps the
texture for a **vector Earth**, coastlines and a graticule as glowing lines,
keeping the towers and the double-helix links exactly as they are. The result is
the arcade game's look at planet scale, and it is very likely prettier than the
photo. The Node Map panel keeps its current texture; this is a mode skin, not a
change to the map.

---

## 4. Your fighter and your node

### Home tower

The wallet already knows its own node's public IP and geo position: that is the
`self` point on the Node Map. That tower is your **home**. Your fighter launches
from it, spawns there after being shot down, and repairs there fastest.

Nodes are classified today by advertised client string
(`ui/src/wallet/nodeTypes.ts`: old core, DD69 core, Box Wallet, Lovenode). Those
classes should become **tower classes** with different silhouettes and different
service rates, which turns an existing honest piece of network data into
gameplay for free.

Players with no node of their own (guest accounts, snapshot-only installs) get
the **nearest public tower** as home. Nobody is locked out for not running a
node, but running one is visibly better, which is exactly the right incentive
for Divi.

### Docking

Fly within 3 units of a tower tip below 8 units/s and you dock. Docked for a few
seconds you get:

| | Your own tower | Any other tower |
|---|---|---|
| Shields | full, 3 s | full, 8 s |
| Ammo | full, instant | full, 5 s |
| Boost cells | full | half |

Docking anywhere works, so a fight far from home is survivable; home is simply
twice as good. **No hard fuel.** Running out of boost should cost you an
advantage, never strand you: being unable to move in a multiplayer game is the
fastest way to make someone quit.

### Flight model

Same crosshair-led aiming as the solo game, which is now proven: the crosshair
goes where you point and the ship follows it. Added for Orbit mode:

* Chase camera behind the fighter, pulling back with speed.
* Throttle and boost (shift, or right button).
* Gravity-free but surface-clamped: you cannot fly below the surface, and
  ploughing into it costs shields and bounces you off.
* Towers are solid.

---

## 5. Multiplayer

### Transport

**One Cloudflare Durable Object per room, WebSocket, server tick 20 Hz.** This is
the same shape as the DreadRoot multiplayer plan
(`dreadroot/docs/MULTIPLAYER_CDO_PLAN_V3.md`), and its hardest-won lesson applies
here directly: **do server-owned enemies before player authority**. Get the
server running the TIEs and arbitrating hits while players are still simple
position broadcasters, and the difficult part is done while the stakes are low.

* Start with **one global room**. Shard by player count later, and only then.
* Clients interpolate other players and predict their own ship locally.
* The room **hibernates when empty**. A game nobody is playing must cost nothing:
  same standing rule as never leaving a GPU pod running.

### Wire format

Per player per tick, quantised: id 2 bytes, latitude and longitude 2 bytes each,
altitude 1, yaw and pitch 1 each, roll 1, state flags 1, shields 1. **12 bytes.**
At 20 Hz with 32 players that is under 8 KB/s down per client, which is nothing.
Fire events, hits, docking and deaths are separate reliable messages, not part of
the tick.

### Identity

**Sign with your Divi address.** No login, no password, no LW-SSO: the decision
already locked in for Community Apps, and it keeps this off the critical path of
an account system that does not exist. The room hands out a nonce, the wallet
signs it, the room verifies.

Your callsign is your **HRA** if you have one, otherwise a shortened address.
That gives Human Readable Addresses a reason to exist that people can see, which
is worth more than a feature page.

### Anti-cheat, proportionate

Hits are reported by the shooter and validated by the server for fire rate,
range and line of sight. That stops the lazy cheats and not the determined ones.
For a free arcade game with no prizes that is the right amount of effort, and
the spec says so rather than pretending otherwise. **Nothing in this game pays
out DIVI**, which is what keeps it true.

---

## 6. Enemies, and something to defend

Server-spawned interceptor waves, owned by the Durable Object so everybody
fights the same enemies in the same places. Count scales with the number of
players online, and enough spawn for one player alone, because an empty
multiplayer game that gives a lone player nothing to do is dead on arrival.

**The shared objective: the interceptors attack the towers.** A tower under
attack loses shields, goes dark for a while if it falls, and comes back after a
cooldown. Players defend it together. This is the thing that makes Orbit mode
more than a deathmatch, and it means the game is about protecting the network,
which is the most on-brand objective available. A player's own tower falling
should sting, and should be visible to them in the Node Map afterwards as a
score, never as anything that touches the real node.

---

## 7. The living network

This is the best part of the brief and most of it is already in the tree.

| Real event | In the game | Where the data is today |
|---|---|---|
| Transaction relayed | A bright packet runs the helix between the two towers | mempool, plus the existing hex-glyph flow in `GlobeMap.tsx` |
| New block | A ripple crosses the planet from the winning tower | `BlockDto` in `crates/app/src/main.rs` |
| Stake winner | That tower flares gold and drops a reward crate into orbit | `BlockDto.stake_winner` and `stake_amount`, already there |
| Weekly lottery draw | The biggest event in the game: a gold beam, a swarm of high-value pickups | `lottery_info` gives the draw height and estimated time, so it can be **counted down to in-game** |
| A new node joins | A new tower rises out of the surface | `ui/src/wallet/newNodes.ts` already detects arrivals |
| A node goes offline | The tower goes dark | `knownPeers` lastSeen |
| Network busy | Denser traffic on the links | mempool size |

Two rules that keep this honest.

1. **Events come from one source, not from each player's node.** The room polls
   the London read-only chain proxy (the same `DIVI_CHAIN_PROXY_URL` the points
   system already uses) and broadcasts. Otherwise every player sees a slightly
   different world depending on their own node's sync state, and a client could
   simply lie about a lottery win.
2. **Nothing the player does touches the chain, and the game never implies it
   does.** Flying through a transaction stream gives a speed boost. Collecting a
   stake crate gives game points. It must never look like you intercepted
   somebody's money. This is the wallet's own honesty standard applied to a toy.

The countdown to the weekly lottery is the strongest retention hook here and it
costs almost nothing: the number already exists.

---

## 8. What gets reused

Almost all of the world already exists.

* `ui/src/wallet/GlobeMap.tsx`: tower geometry, the double-helix links, the
  single-draw-call hex glyph system, great-circle arcs, cluster packing.
* `ui/src/wallet/knownPeers.ts`: the node registry, 90 day TTL, own-IP stripping.
* `ui/src/wallet/geoCache.ts`, `newNodes.ts`, `nodeTypes.ts`.
* `ui/src/wallet/activityPulse.ts`: the ping ripple, already the right idea.
* The solo game's aiming model, sound engine and scoring.
* Theme tokens, so the whole thing stays skinnable like everything else.

New: the fighter and its flight model, the chase camera, the vector Earth skin,
the Durable Object room, the wire format, the event feed, and docking.

---

## 9. Phases

Each one is playable or verifiable on its own, and each is worth stopping at.

0. **Decide.** Panel rather than sandbox. Confirm the scale and speed. Confirm
   the vector Earth skin.
1. **Fly, alone.** The globe scene with a fighter, chase camera, surface and
   tower collision, docking and rearming at your own node. No server at all.
   This is where the feel is won or lost, and it needs nobody else online.
2. **Presence.** The Durable Object room, sign-in by address, other players
   visible and interpolated. No combat sync yet.
3. **Server-owned enemies.** The room spawns and owns the interceptors, players
   report hits, the room arbitrates and keeps score.
4. **The living network.** The room polls the chain proxy and broadcasts blocks,
   stake winners, arrivals and the lottery countdown.
5. **Defend the network.** Towers take damage, players defend them, leaderboards
   and HRA callsigns.

Phase 1 is the one to build first and the one most likely to change everything
else, because a mini-globe dogfight either feels wonderful or feels cramped and
there is no way to find out by writing more of this document.

---

## 10. Risks and open questions

**Privacy, and this is the one that needs a decision from Geoff.** Orbit mode
broadcasts your home tower to every other player, and your callsign is derived
from your Divi address. That links a pseudonymous crypto address to an
approximate physical location, for anyone who logs the room. Node IPs are
already public, but nobody has previously joined them up to an address and put
it on a screen. Options, and one should be chosen before Phase 2 ships:
choose any tower as your hangar rather than your real one; fuzz the launch
position to the nearest city; make the whole thing opt-in with the trade-off
spelled out. Doing nothing is also a choice and it should be a deliberate one.

**Frame rate.** The globe already draws hundreds of towers, helix tubes and a
GPU points system, and it does not currently have to hold 60 fps. Adding
players, enemies and projectiles needs a measured budget. Towers almost
certainly need instancing. Measure in Phase 1 before building Phase 3.

**An empty room.** Divi is not a big network, and most of the time there may be
one player. Server enemies and the live chain events have to carry a solo
session on their own. If Orbit mode is only fun with six people in it, it will
never be fun.

**Server input is untrusted.** As a wallet panel, the game runs inside the
wallet's own document. Everything arriving from the room must be schema
validated and treated as hostile; the room must never send anything that becomes
a URL, markup or code. This is the price of leaving the sandbox and it has to be
paid deliberately.

**Cost.** One Durable Object with hibernation is small money, but it is not zero
and it runs whenever anyone plays. It needs a cap and an alert, and the empty
room must genuinely sleep.

**Scope.** This is several times the size of the solo game. Phase 1 alone is a
real piece of work, and Phases 2 to 5 each depend on the one before.

---

## 11. Recommendation

Build Phase 1 and stop. A fighter flying over the real node globe, launching
from your own tower, docking to rearm, with the towers and helix links already
looking the way they do, is worth having on its own even if multiplayer never
happens. It answers the only question this document cannot: whether a planet 400
metres around is a joy to fly around or a goldfish bowl.

Related: `docs/ARCADE-GAME-FEASIBILITY.md`, `docs/COMMUNITY-APPS-SCOPE.md`,
`docs/NODE-TYPES-SCOPE.md`, `docs/POINTS-AND-BUYING.md`.
