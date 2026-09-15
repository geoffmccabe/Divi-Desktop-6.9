// The room: one Durable Object per shared world.
//
// THE ONE IDEA HERE
// -----------------
// The room runs the fight. Not a copy of the fight, not a check on the client's
// fight — the fight. Fighters, bullets, hits, kills, coins and waves all live in
// this object's memory, and a cockpit is a camera with a joystick attached.
//
// That is the difference between a leaderboard and a faucet. Divi Rebels pays
// out real DIVI at a thousand kills, and the moment money is attached to a
// number the client computes, the number is worth exactly as much as the
// player's honesty. Nobody sensible bets a treasury on that.
//
// WHAT IS STILL TAKEN ON TRUST
// ----------------------------
// Where a player's own ship is. A cockpit reports its position and the room
// believes it, within limits: a report that moves further than the ship can
// physically fly since the last one is refused and the player is snapped back.
// Full server-side flight is the right end state and is not hard, but it is the
// half that needs prediction and reconciliation to feel right, and shipping it
// badly makes the game worse while making it no harder to cheat at the thing
// that pays. Fighters and hits first, flight second. DreadRoot's own multiplayer
// audit reached the same order for the same reason.
//
// So: a liar can put their ship somewhere it could not quite have got to, and
// gain a little. A liar cannot invent kills, damage, coins, waves, ammunition or
// DIVI, because none of those are things they are ever asked about.

import * as THREE from "three";
import {
  createCombat, stepCombat, clearEvents, startWave, fireBeam, dropGem, type Gem,
  setDropRandomForTests, clampReach, pushBullet,
  type WingBody,
  fireGuns, fireMini, fireTorpedo, detonateOldest, miniMuzzle,
  MINI_AMMO, MINI_INTERVAL, COIN_PER_KILL, COIN_VALUE, STAKE_BONUS, STAKE_BONUS_MS,
  BULLET_SPEED, BULLET_LIFE, CONVERGE,
  type CombatState, type CombatWorld, type PlayerBody,
} from "../../../ui/src/wallet/rebels/rebelsCombat";
import {
  MAX_SHIELD, MAX_AMMO, MAX_TORPEDOES, MAX_GUARDS, GUARD_SECONDS, GUARD_ABSORB, CRASH_DAMAGE,
  BOOST,
} from "../../../ui/src/wallet/rebels/orbitFlight";
import { R, MIN_ALT, MAX_ALT } from "../../../ui/src/wallet/rebels/orbitWorld";
import { VIEW, inRange } from "../../../ui/src/wallet/rebels/rebelsView";
import {
  WING_MAX, wingPosition, wingSpin, wingShare, wingRounds, wingTiers,
} from "../../../ui/src/wallet/rebels/rebelsWings";
import { distanceToTower, DOCK_RANGE, DOCK_SECONDS } from "../../../ui/src/wallet/rebels/orbitFlight";
import { weaponByKey, BEAM_SECONDS, BEAM_AMMO } from "../../../ui/src/wallet/rebels/weaponCatalog";
import { ALL_ITEMS, torpedoBonus, magBonus, RESPAWN_WAIT, RESPAWN_VIP, superBoostMult, strafeMult, vstrafeMult, hullMult } from "../../../ui/src/wallet/rebels/itemCatalog";
import { fetchDropConfig } from "../../../ui/src/wallet/rebels/dropConfigRemote";
import { DEFAULT_DROP_CONFIG, type DropConfig } from "../../../ui/src/wallet/rebels/dropCharts";
import { ammoFor, torpedoesFor, topSpeedFor, shieldMaxFor, recharge, supercharge, SUPER_BOOST_MULT, type Extras } from "../../../ui/src/wallet/rebels/orbitFlight";
import {
  r1, type ClientMessage, type ServerMessage, type Vec,
  type PaintWire, type PaintPart, nextRoom,
} from "./protocol";
import { runRoomCheat } from "./cheats";
import { stateMessages } from "./broadcast";
import { whoJoins, mayCheat, mayCashOut, shipFor, GUEST_CASH_OUT } from "./identity";
import { bankRun, requestCashOut, readPurse, type LedgerBinding } from "./economy";

/** Twenty ticks a second. Fast enough for dogfighting, cheap enough to run
 *  dozens of rooms; the cockpit interpolates between them. */
const HZ = 20;
const DT = 1 / HZ;

/** Hard ceiling on a room. Beyond this the sky is soup anyway. */
const MAX_SEATS = 24;

/** A single message may not be bigger than this. Nothing legitimate is. */
const MAX_FRAME = 2048;

/** Seconds on the ground after being shot down. Geoff's figure. */
/* Thirty seconds down, or ten with a VIP Pass among the seat's gear. The
   figures are the item catalogue's, so the shop and the room agree. */
const RESPAWN_SECONDS = RESPAWN_WAIT;

/** A thousand kills is a hundred DIVI. */
const KILLS_PER_PAYOUT = 1000;
const DIVI_PER_PAYOUT = 100;

/* ---- what the room believes about one player ---- */
/**
 * One wingman on one seat.
 *
 * Its hull and its magazine are shares of the ship it flies with, worked out
 * from its tier when the gear is declared, so a bigger ship carries stronger
 * drones without a second table anywhere.
 */
interface Wing {
  slot: number;
  tier: number;
  hull: number;
  hullMax: number;
  ammo: number;
  ammoMax: number;
  pos: THREE.Vector3;
}

interface Seat {
  id: string;
  ws: WebSocket;
  node: string;
  /* ---- WHO GETS PAID ----
     The ledger account. It is the address the socket connected FROM, as
     Cloudflare saw it, and not the node string the client sent: that string is
     typed by the client and a client can type anything. Money is attached to
     this, so it has to be something the client cannot choose. A node's public
     address is the one thing about it nobody else can present.

     The cost is honest: two players behind one home router share an account,
     and a VPN moves yours. Both are stated in the panel. */
  account: string;
  /** Came in through divi.love/rebels without signing in. Banked to its own
   *  account (see onJoin) and cannot cash out until signed in. */
  guest: boolean;
  /** When the last cash-out was asked for, so the ledger is not hammered. */
  lastClaim: number;
  /* ---- what they bought ----
     Weapon and item keys, declared on join. The room takes them at the
     client's word, which is the same trust the scores and the paint get and
     is stated here so nobody mistakes it for a check: a client that lies
     about owning a beam gets a beam. The honest fix is the same as for
     points, a purchase record the server can read, and it is not built. What
     the room DOES do is refuse a weapon that was not declared, so the fight
     everyone sees is at least the fight each client said it was bringing. */
  gear: Set<string>;
  ammoMax: number;
  torpsMax: number;
  shieldMax: number;
  extras: Extras;
  /**
   * The wingmen flying formation on this ship.
   *
   * The room's, entirely: what the client declares is how many of each tier
   * the ACCOUNT holds, and everything after that (where they are, what they
   * have left, whether they are still there) is decided here.
   */
  wings: Wing[];
  /** Room clock of the last Y, so a client cannot pour recharges in. */
  lastUse: number;
  /**
   * The tip of THIS player's own tower, as they reported it on joining.
   *
   * Docking is measured against it and nothing else, which is the same rule
   * the flight model follows: nodes cluster, and "the nearest tower" is very
   * often a neighbour's. It also means the room does not need the whole map,
   * which is thousands of towers and not something to put on a wire.
   */
  homeTip: THREE.Vector3;
  /** And of the last tower resupply, and of the last gear declaration. */
  lastDock: number;
  lastGear: number;
  /** Self-inflicted damage allowed in the current second. */
  hurtWindow: number;
  hurtSpent: number;
  /** What this seat was told about last tick, so something at the edge of a
   *  range is kept rather than flickering. See KEEP in broadcastState. */
  sawShips: Set<string | number>;
  sawEnemies: Set<string | number>;
  /** Room clock until which this seat does triple damage, and when it last
   *  claimed the bonus, so the claim cannot simply be repeated. */
  bonusUntil: number;
  lastBonus: number;
  /** The most this ship can move in a second, from its gear. */
  topSpeed: number;
  lastBeam: number;
  /* ---- the flock tally ----
     Members of each fleet this seat has downed, by fleet id. Internal: the
     player sees only flock kills. Cleared with the fleet. */
  tally: Map<number, number>;
  /** Flock kills, gems and items picked up since the last banking. */
  flocks: number;
  gems: number[];
  items: Record<string, number>;
  name: string;
  /** Which hull they fly and how it is painted, so the room can tell everyone
   *  else what this player looks like. Paint, not gameplay: see onJoin. */
  ship: string;
  paint?: PaintWire;
  home: THREE.Vector3;
  body: PlayerBody;

  /* Gauges. Every one of these is the room's, and none is ever read off the
     wire. A cockpit showing a different number is a cockpit that is wrong. */
  shield: number;
  ammo: number;
  torps: number;
  guards: number;
  guardFor: number;
  wantGuard: boolean;

  score: number;
  kills: number;
  /** Fractional DIVI picked up as coins, plus the kill bounty. */
  divi: number;

  dead: boolean;
  respawn: number;

  /* ---- rate limiting ----
     Every one of these is checked against what the GAME allows rather than
     against a round number, so the limit cannot be tightened by accident into
     something a good player trips. */
  lastMain: number;
  lastMini: number;
  lastTorp: number;
  tfWindow: number;
  tfCount: number;
  strikes: number;
  joined: boolean;
  /**
   * In the fight, as against merely seated.
   *
   * True only between LAUNCH and death. The roster the simulation runs on is
   * built from this, not from `joined`, so a player reading the launch card is
   * not a target and does not keep a wave alive. See FlyIn.
   */
  flying: boolean;
}

interface Env {
  ROOM: DurableObjectNamespace;
  LEDGER: DurableObjectNamespace;
}

/* Scratch for the wingmen's aim, which is worked out once per round fired. */
const _wingAim = new THREE.Vector3();
/* And for weighing up how far away something happened. */
const _evAt = new THREE.Vector3();
/** The few things everybody is told about, wherever they are. */
const GLOBAL_EVENTS = new Set(["waveStart", "dragon", "dragonGone"]);

export class RebelsRoom {
  private seats = new Map<string, Seat>();
  /** This room's own name ("earth", "earth-2"...), read from the address it is
   *  reached at, so a full room can say which overflow room comes next. */
  private roomName = "earth";
  private combat: CombatState = createCombat();
  private world: CombatWorld;
  private tips: THREE.Vector3[] = [];
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextSeat = 1;
  /** Simulated seconds since the room started. All fire-rate limits are in
   *  this clock, not the wall clock, so a stalled tick cannot be used to fire
   *  faster. */
  private now = 0;

  constructor(private state: DurableObjectState, private env: Env) {
    this.world = {
      tips: this.tips,
      playerPos: new THREE.Vector3(),
      playerFwd: new THREE.Vector3(0, 0, 1),
      players: [],
      /* Per shooter: the stake bonus belongs to a seat. */
      damageScale: (owner: string) => (this.seats.get(owner)?.bonusUntil ?? -99) > this.now ? STAKE_BONUS : 1,
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const named = /^\/room\/([A-Za-z0-9_-]{1,40})/.exec(url.pathname);
    if (named) this.roomName = named[1];

    if (url.pathname.endsWith("/state")) {
      return Response.json({
        players: this.seats.size,
        wave: this.combat.wave?.n ?? 0,
        enemies: this.combat.enemies.length,
        tick: this.tick,
      });
    }

    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket", { status: 426 });
    }
    if (this.seats.size >= MAX_SEATS) {
      /* Full. Accepted just long enough to say where to go instead, because a
         browser cannot read a refused websocket's status and would retry this
         same full room forever. */
      const turned = new WebSocketPair();
      const [away, here] = Object.values(turned) as [WebSocket, WebSocket];
      here.accept();
      try {
        here.send(JSON.stringify({ t: "full", next: nextRoom(this.roomName) }));
        here.close(4001, "room full");
      } catch { /* gone already */ }
      return new Response(null, { status: 101, webSocket: away });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.seat(server, req.headers.get("CF-Connecting-IP") ?? "");
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---- seats ---- */

  private seat(ws: WebSocket, from = ""): void {
    const id = `s${this.nextSeat++}`;
    const seat: Seat = {
      id, ws, node: "", name: "", ship: "", paint: undefined,
      account: from, guest: false, lastClaim: -99,
      gear: new Set(), ammoMax: MAX_AMMO, torpsMax: MAX_TORPEDOES, shieldMax: MAX_SHIELD, topSpeed: topSpeedFor(), lastBeam: -99,
      extras: { torpedoes: 0, magazine: 0, superMult: SUPER_BOOST_MULT, strafeMult: 1 }, lastUse: -99, lastDock: -99, lastGear: -99, hurtWindow: -99, hurtSpent: 0, bonusUntil: -99,
      sawShips: new Set(), sawEnemies: new Set(),
      /* Far enough back that the first claim in a fresh room is not inside
         the five-minute gap: the room clock starts at zero. */
      lastBonus: -1e9,
      tally: new Map(), flocks: 0, gems: [0, 0, 0, 0, 0, 0, 0], items: {}, wings: [],
      home: new THREE.Vector3(0, 0, R),
      homeTip: new THREE.Vector3(0, 0, R + 6),
      body: { id, pos: new THREE.Vector3(0, 0, R + 8), fwd: new THREE.Vector3(0, 1, 0), guard: false },
      shield: MAX_SHIELD, ammo: MAX_AMMO, torps: MAX_TORPEDOES,
      guards: MAX_GUARDS, guardFor: 0, wantGuard: false,
      score: 0, kills: 0, divi: 0,
      dead: false, respawn: 0,
      lastMain: -99, lastMini: -99, lastTorp: -99,
      tfWindow: 0, tfCount: 0, strikes: 0, joined: false, flying: false,
    };
    this.seats.set(id, seat);

    ws.addEventListener("message", (ev) => this.onMessage(seat, ev));
    ws.addEventListener("close", () => this.leave(seat));
    ws.addEventListener("error", () => this.leave(seat));

    this.send(seat, { t: "hi", id, hz: HZ });
    this.start();
  }

  private leave(seat: Seat): void {
    if (!this.seats.delete(seat.id)) return;
    seat.flying = false;
    /* Whatever they earned is banked before the socket is forgotten, so
       closing the lid is not a way to lose someone else's money — or a way to
       keep yours out of the ledger's sight. */
    void this.bank(seat);
    this.refreshRoster();
    this.sendRoster();
    if (this.seats.size === 0) this.stop();
  }

  /* ---- the clock ---- */

  private start(): void {
    if (this.timer) return;
    void this.loadGems();
    this.combat = createCombat();
    this.combat.drops = this.drops;
    void this.refreshDrops();
    this.now = 0;
    startWave(this.combat, 1);
    this.timer = setInterval(() => {
      try { this.step(); } catch { /* one bad tick must not stop the room */ }
    }, 1000 / HZ);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    void this.saveGems();
  }

  /* ---- the wingmen ----
     They fly formation and nothing else: the ring's places are fixed in the
     ship's own frame and the whole ring rolls slowly when there are two or
     more of them, so there is no flying to do, only placing. What makes
     them matter is that they are real bodies (rounds hit them) and they
     fire when their owner fires. */
  private stepWings(): void {
    const bodies: WingBody[] = [];
    for (const s of this.seats.values()) {
      if (!s.flying || s.dead || s.wings.length === 0) continue;
      const alive = s.wings.filter((x) => x.hull > 0);
      const spin = wingSpin(this.now, alive.length);
      /* The ship's up, from its own frame: the room has no roll on the wire,
         so away from the planet stands in, which is what level flight is. */
      const up = s.body.pos.clone().normalize();
      const frame = { pos: s.body.pos, fwd: s.body.fwd, up };
      for (const wing of alive) {
        wingPosition(frame, wing.slot, spin, s.body.reach ?? 2.2, wing.pos);
        bodies.push({ owner: s.id, slot: wing.slot, pos: wing.pos, hull: wing.hull });
      }
    }
    this.world.wings = bodies.length ? bodies : undefined;
  }

  private refreshRoster(): void {
    const live: PlayerBody[] = [];
    for (const s of this.seats.values()) if (s.flying && !s.dead) live.push(s.body);
    this.world.players = live;
    /* The solo fields still have to point at something real: parts of the
       simulation fall back to them when the roster is empty. */
    const first = live[0];
    if (first) {
      this.world.playerPos = first.pos;
      this.world.playerFwd = first.fwd;
    }
  }

  private step(): void {
    this.now += DT;
    this.tick++;

    /* Guards, before the fight, so a shield raised this tick is up for it.
       Same rule as the cockpit's: held, one charge every half second. */
    for (const s of this.seats.values()) {
      s.guardFor = Math.max(0, s.guardFor - DT);
      if (s.wantGuard && !s.dead && s.guardFor <= 0 && s.guards > 0) {
        s.guards -= 1;
        s.guardFor = GUARD_SECONDS;
      }
      if (!s.wantGuard) s.guardFor = 0;
      s.body.guard = s.guardFor > 0;

      if (s.dead) {
        s.respawn -= DT;
        if (s.respawn <= 0) this.revive(s);
        /* Twice a second while they wait, because this is the one message a
           dead player needs and the rest of the tick is skipped when nobody
           is flying. */
        else if (this.tick % (HZ / 2) === 0) this.sendYou(s);
      }
    }

    this.refreshRoster();
    if (this.world.players!.length === 0) { clearEvents(this.combat); return; }
    this.stepWings();

    stepCombat(this.combat, DT, this.world);
    /* Gems move; their saved positions should not go stale. */
    this.gemSaveAt += DT;
    if (this.gemSaveAt >= 30 && this.combat.gems.length) { this.gemSaveAt = 0; void this.saveGems(); }
    this.dropsAt += DT;
    if (this.dropsAt >= 600) { this.dropsAt = 0; void this.refreshDrops(); }
    this.settle();
    this.broadcastState();
    clearEvents(this.combat);
  }

  /**
   * Turn this tick's events into gauges.
   *
   * EVERY consequence of the fight is applied here, on the server, from events
   * the server's own simulation raised. Nothing in this function reads anything
   * a client said.
   */
  private settle(): void {
    const evs: Array<Record<string, unknown>> = [];

    for (const ev of this.combat.events) {
      evs.push({
        k: ev.kind, at: [r1(ev.at.x), r1(ev.at.y), r1(ev.at.z)] as Vec, p: ev.power,
        ...(ev.who ? { who: ev.who } : {}),
        ...(ev.tier ? { tier: ev.tier } : {}),
        ...(ev.shield !== undefined ? { sh: Math.round(ev.shield * 100) / 100 } : {}),
        ...(ev.damage !== undefined ? { dmg: Math.round(ev.damage) } : {}),
        ...(ev.wave ? { wave: ev.wave } : {}),
        ...(ev.guarded ? { g: 1 } : {}),
        ...(ev.gem !== undefined ? { gem: String(ev.gem) } : {}),
        ...(ev.item ? { item: ev.item } : {}),
        ...(ev.id ? { id: ev.id } : {}),
      });

      const who = ev.who ? this.seats.get(ev.who) : undefined;

      if (ev.kind === "enemyHit" && who) {
        /* Points are the damage that landed, exactly as in the solo game. */
        who.score += Math.round(ev.damage ?? 0);
      } else if (ev.kind === "enemyDown" && who) {
        /* A fighter is a kill; a flock member a fifth of one. */
        who.kills += ev.worth ?? 1;
        if (ev.fleet !== undefined && (ev.worth ?? 0) > 0) this.tallyFlock(who, ev);
      } else if (ev.kind === "wingHit" && who && ev.slot !== undefined) {
        /* A round that hit a wingman instead of the ship. The hull is the
           room's, so it comes off here. */
        const wing = who.wings.find((x) => x.slot === ev.slot);
        if (wing && wing.hull > 0) {
          wing.hull -= ev.damage ?? 25;
          if (wing.hull <= 0) {
            wing.hull = 0;
            this.combat.events.push({
              kind: "wingDown", at: wing.pos.clone(), power: 2, who: who.id, slot: wing.slot,
            });
          }
        }
      } else if (ev.kind === "drop" && ev.id) {
        /* A wreck left something. The simulation put it in orbit; the room
           writes it down so a restart finds it. */
        const g = this.combat.gems.find((x) => x.id === ev.id);
        if (g) void this.saveGem(g);
      } else if (ev.kind === "gem" && who && ev.tier) {
        /* Property: the seat's, banked to the account, and gone from the
           world for good. An item counts by its key; a flock gem by tier. */
        if (ev.item) who.items[ev.item] = (who.items[ev.item] ?? 0) + 1;
        else who.gems[ev.tier - 1] = (who.gems[ev.tier - 1] ?? 0) + 1;
        const id = ev.id ?? this.gemIdAt(ev.at);
        if (id) { this.gemPos.delete(id); void this.state.storage.delete(`gem:${id}`); }
        /* The bounty, in DIVI, at the rate the payout promises: a thousand
           kills is a hundred DIVI, so a kill is a tenth. The coins scattered by
           the wreck are the same tenth made visible and collectable, so only
           ONE of the two may be credited or the rate silently doubles. The
           coins are the ones that count, because they have to be flown down. */
      } else if (ev.kind === "coin" && who) {
        who.divi += ev.value ?? COIN_VALUE;
      } else if (ev.kind === "playerHit" && who && !who.dead) {
        const soak = ev.guarded ? 1 - GUARD_ABSORB : 1;
        who.shield -= (ev.damage ?? 25) * soak;
        if (who.shield <= 0) this.down(who);
      }
    }

    if (evs.length > 0) {
      /* ---- YOU HEAR WHAT YOU CAN SEE ----
         Three rules. Anything that happened TO you or BY you reaches you
         wherever you are: a warning that a round is on its way, a hit you
         took, a gem you picked up. A handful of things are the whole world's
         business: a wave arriving, and the dragon. Everything else is a bang
         somewhere, and a bang beyond the horizon is a sound from nowhere: it
         used to be sent to everybody, so a player alone at a planet heard
         every explosion at Earth. */
      for (const s of this.seats.values()) {
        const eye = s.body.pos;
        const list = evs.filter((e) => {
          if (e.who === s.id) return true;
          if (e.k === "incoming") return false;
          if (GLOBAL_EVENTS.has(String(e.k))) return true;
          const at = e.at as [number, number, number];
          return inRange(eye, _evAt.set(at[0], at[1], at[2]), VIEW.events);
        });
        if (list.length > 0) this.send(s, { t: "e", v: list as never });
      }
    }
  }

  /* ---- flock kills and gems ----
     Geoff: "In order for a player to get a 'Kill' for a flock, they need to
     kill over 50% of its members. Keep track of all the members of a flock
     that have been killed by each player, but only record flock kills. When
     the last member of a flock is killed, it will leave a GEM of that tier."
     The tally is per seat per fleet; when the fleet's last member falls the
     seat over half takes the kill, and a gem of the tier goes into orbit
     where it fell. The gem is written to storage at once: it persists. */
  private tallyFlock(who: Seat, ev: { fleet?: number; fleetTotal?: number; fleetLeft?: number; tier?: number; at: THREE.Vector3 }): void {
    const fleet = ev.fleet!;
    who.tally.set(fleet, (who.tally.get(fleet) ?? 0) + 1);
    if ((ev.fleetLeft ?? 1) > 0) return;
    const total = ev.fleetTotal ?? 0;
    let winner: Seat | null = null;
    for (const s of this.seats.values()) {
      const n = s.tally.get(fleet) ?? 0;
      if (total > 0 && n > total / 2) winner = s;
      s.tally.delete(fleet);
    }
    const tier = ev.tier ?? 1;
    if (winner) winner.flocks += 1;
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const gem = dropGem(this.combat, tier, ev.at, id);
    void this.saveGem(gem);
    this.combat.events.push({ kind: "flockDown", at: ev.at.clone(), power: 3, tier, who: winner?.id ?? "", gem: tier });
  }

  private gemIdAt(at: THREE.Vector3): string | null {
    /* The gem that was just taken is no longer in the list; the event says
       where it was. Storage keys are by id, so the id is looked up by
       position among what was saved last. */
    let best: string | null = null;
    let bestD = 4;
    for (const [id, p] of this.gemPos) {
      const d = p.distanceTo(at);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) this.gemPos.delete(best);
    return best;
  }

  /** Where each gem was last saved, by id, so a pickup can find its key. */
  private gemPos = new Map<string, THREE.Vector3>();
  private gemSaveAt = 0;

  private async saveGem(g: Gem): Promise<void> {
    this.gemPos.set(g.id, g.pos.clone());
    try {
      await this.state.storage.put(`gem:${g.id}`, {
        id: g.id, tier: g.tier, body: g.body,
        p: [g.pos.x, g.pos.y, g.pos.z], v: [g.vel.x, g.vel.y, g.vel.z], spin: g.spin,
        ...(g.item ? { item: g.item, owner: g.owner ?? "", hidden: Math.round(g.hidden ?? 0) } : {}),
      });
    } catch { /* storage unhappy; the gem still exists in memory */ }
  }

  /* ---- drop charts ----
     Read from the table on start and every ten minutes, so an admin edit
     reaches a running room without a restart. The default until then. */
  private drops: DropConfig = DEFAULT_DROP_CONFIG;
  private dropsAt = 0;
  private async refreshDrops(): Promise<void> {
    if (!this.dropsOn) return;
    const r = await fetchDropConfig();
    this.drops = r.config;
    this.combat.drops = r.config;
  }
  /** Tests: no network, and a pinned roll. */
  dropsOn = true;
  setDropsForTests(cfg: DropConfig | null, rand: (() => number) | null): void {
    this.dropsOn = false;
    this.drops = cfg ?? DEFAULT_DROP_CONFIG;
    this.combat.drops = this.drops;
    setDropRandomForTests(rand);
  }

  /** Every so often, and at stop, write where the gems are now, so a restart
   *  finds them where they were and not where they were born. */
  private async saveGems(): Promise<void> {
    for (const g of this.combat.gems) await this.saveGem(g);
  }

  private async loadGems(): Promise<void> {
    try {
      const all = await this.state.storage.list<{ id: string; tier: number; body: number; p: number[]; v: number[]; spin: number; item?: string; owner?: string; hidden?: number }>({ prefix: "gem:" });
      for (const g of all.values()) {
        if (this.combat.gems.some((x) => x.id === g.id)) continue;
        const gem: Gem = {
          id: g.id, tier: g.tier, body: g.body ?? 0,
          pos: new THREE.Vector3(g.p[0], g.p[1], g.p[2]),
          vel: new THREE.Vector3(g.v[0], g.v[1], g.v[2]),
          spin: g.spin ?? 0,
          /* An item that was private when the room stopped: its owner's seat
             is gone with the restart, so it becomes everyone's. */
          ...(g.item ? { item: g.item, owner: "", hidden: 0 } : {}),
        };
        this.combat.gems.push(gem);
        this.gemPos.set(gem.id, gem.pos.clone());
      }
    } catch { /* nothing saved, or storage unhappy */ }
  }

  private down(s: Seat): void {
    s.dead = true;
    /* Out of the fight until LAUNCH is pressed again. Reviving used to put the
       seat straight back on the roster, so the waves carried on around a ship
       parked on its pad while the player was still looking at the card, and
       the next launch dropped them into a fight already in progress with
       fighters on top of them. */
    s.flying = false;
    s.respawn = s.gear.has("vip") ? RESPAWN_VIP : RESPAWN_SECONDS;
    s.shield = 0;
    s.guardFor = 0;
    s.body.guard = false;
    /* Earnings survive death, as promised. Only the ship is lost. */
    void this.bank(s);
    this.refreshRoster();
    /* ---- AND TELL THEM AT ONCE ----
       The wait is the room's number, so the cockpit cannot know it until it
       is sent. Without this the last player alive got no countdown at all:
       the room stops ticking when nobody is flying, so the next gauge
       message never came, and the cockpit offered LAUNCH AGAIN immediately
       while the room still had the seat dead. */
    this.sendYou(s);
    /* ---- EVERYONE DOWN: THE FIGHT STARTS OVER ----
       Geoff: "the game resets once all the players have died, or if no one
       is playing, it will start over. Otherwise the waves will just keep
       increasing until everyone is dead or given up." An empty room already
       starts fresh (see start); this is the other half. Wave one, nothing in
       the air. The gems stay: they are property, not part of the fight. */
    let anyoneLeft = false;
    for (const o of this.seats.values()) if (o.flying && !o.dead) anyoneLeft = true;
    if (!anyoneLeft) this.resetFight();
  }

  private resetFight(): void {
    const gems = this.combat.gems;
    this.combat = createCombat();
    this.combat.gems = gems;
    for (const o of this.seats.values()) o.tally.clear();
    startWave(this.combat, 1);
  }

  private revive(s: Seat): void {
    s.dead = false;
    this.refill(s);
    /* Back on your own pad, which is where a launch happens. */
    s.body.pos.copy(s.home).normalize().multiplyScalar(R + 8);
    this.refreshRoster();
  }

  /**
   * Full gauges, without moving the ship.
   *
   * Separate from revive because a LAUNCH is not always a respawn. On the first
   * one the cockpit is already at its own pad and flying its dive, and putting
   * the room's copy back on the pad underneath it opened a gap the room then
   * corrected: the ship snapped backwards at the moment of launch. A seat that
   * actually died is placed by revive; a seat that is merely starting a run is
   * only filled up.
   */
  private refill(s: Seat): void {
    s.shield = s.shieldMax;
    s.ammo = s.ammoMax;
    s.torps = s.torpsMax;
    s.guards = MAX_GUARDS;
    /* Geoff: "drones get replenished along with your ship in the same way at
       the same time." */
    for (const wing of s.wings) { wing.hull = wing.hullMax; wing.ammo = wing.ammoMax; }
  }

  /* ---- the ledger ----
     Banking, cash-out requests and purses are in economy.ts. */
  private async bank(s: Seat): Promise<void> {
    await bankRun(this.env.LEDGER as unknown as LedgerBinding, s);
  }

  /* ---- messages in ---- */

  private onMessage(seat: Seat, ev: MessageEvent): void {
    const raw = ev.data;
    if (typeof raw !== "string" || raw.length > MAX_FRAME) return this.strike(seat, "oversized");

    let msg: ClientMessage;
    try { msg = JSON.parse(raw) as ClientMessage; } catch { return this.strike(seat, "unreadable"); }
    if (!msg || typeof msg !== "object") return this.strike(seat, "unreadable");

    switch (msg.t) {
      case "join": return this.onJoin(seat, msg);
      case "tf": return this.onTransform(seat, msg);
      case "fire": return this.onFire(seat, msg);
      case "det": return this.onDetonate(seat);
      case "use": return this.onUse(seat, msg);
      case "dock": return this.onDock(seat);
      case "cheat": return this.onCheat(seat, msg);
      case "bonus": return this.onBonus(seat);
      case "gear": return this.onGear(seat, msg);
      case "fly": return this.onFly(seat);
      case "hurt": return this.onHurt(seat, msg);
      case "claim": { void this.onClaim(seat, msg); return; }
      case "purse": {
        /* Rate-limited the same way: a panel that polls is fine, a loop that
           hammers the ledger is not. */
        const now = this.now;
        if (now - seat.lastClaim < 2) return;
        seat.lastClaim = now;
        void this.sendPurse(seat);
        return;
      }
      default: return this.strike(seat, "unknown message");
    }
  }

  private onJoin(seat: Seat, m: Extract<ClientMessage, { t: "join" }>): void {
    if (seat.joined) return;                      /* once per socket */
    if (typeof m.node !== "string" || m.node.length === 0 || m.node.length > 80) {
      return this.strike(seat, "bad node");
    }
    const home = vec(m.home);
    if (!home) return this.strike(seat, "bad home");
    seat.node = m.node.slice(0, 80);
    seat.name = String(m.name ?? "").slice(0, 40) || "Unnamed node";
    /* No connecting address (a local run, a test) falls back to the declared
       one. Live, through Cloudflare, there always is one. */
    /* ---- who this is ----
       App players by the address they connect from, web guests by their private
       id: the rules are in identity.ts. No connecting address (a local run, a
       test) falls back to the declared node. */
    const who = whoJoins(seat.account, seat.node, m);
    seat.account = who.account;
    seat.guest = who.guest;
    /* ---- what they look like ----
       Taken on trust, because it is paint: the worst a lie here can do is make
       somebody's ship the wrong colour on somebody else's screen. It is still
       BOUNDED, because it is echoed to every other player in the room and an
       unbounded string from one client repeated to twenty is how one bad
       client becomes everyone's problem. The model id is checked against the
       shape real ones have rather than a list, so the room does not need
       updating every time the pack grows. */
    seat.ship = /^space_SM_Ship_[A-Za-z0-9_]{1,60}$/.test(String(m.ship ?? ""))
      ? String(m.ship) : "";
    /* A web guest flies the first hull, as it comes, until they sign up; the
       room says so too, so a page that claims otherwise is shown the same ship
       as everyone else sees. Its paint is the factory scheme. */
    seat.ship = shipFor(seat, seat.ship);
    if (seat.guest) m = { ...m, paint: undefined };
    seat.paint = cleanPaint(m.paint);
    /* The capture ball. The client measured its own wings; the room only
       keeps it within reason. */
    seat.body.reach = clampReach(Number(m.reach));
    /* Gear: known keys only, bounded, and the magazine and rack sized from
       the items in it exactly as the solo game sizes them. */
    this.applyGear(seat, Array.isArray(m.gear) ? m.gear : [], true, m.drones);
    seat.home.copy(home).normalize().multiplyScalar(R);
    /* Kept as sent, mast and all: the surface point alone cannot say how
       tall the thing is, and docking is measured to the mast. */
    seat.homeTip.copy(home);
    seat.body.pos.copy(seat.home).normalize().multiplyScalar(R + 8);
    seat.joined = true;
    this.refreshRoster();
    this.sendYou(seat);
    this.sendRoster();
    void this.sendPurse(seat);
  }

  /**
   * LAUNCH.
   *
   * The seat joins the fight here and nowhere else. If nobody else is in it,
   * the fight starts over: a launch is a NEW GAME for a player flying alone,
   * which is what Geoff asked for. Geoff, 2026-Sep-13: "when it restarts it
   * seems to not restart fresh with all stats at zero and no enemies around...
   * check that a restart is really a restart."
   */
  private onFly(seat: Seat): void {
    if (!seat.joined || seat.flying) return;
    /* A dead seat has to wait out its countdown; the cockpit does not offer
       LAUNCH AGAIN before then, and this is the other half of that rule. */
    if (seat.dead) return;
    let othersFlying = false;
    for (const o of this.seats.values()) if (o !== seat && o.flying && !o.dead) othersFlying = true;
    if (!othersFlying) this.resetFight();
    seat.flying = true;
    /* Full gauges: this is the start of a run and no damage from the last one
       may be carried into it. The ship is NOT moved, because on a first launch
       the cockpit is already at its pad and flying its dive; a seat that
       actually died was put back on its pad by revive when its countdown ran
       out. */
    this.refill(seat);
    this.refreshRoster();
    this.sendYou(seat);
    this.sendRoster();
  }

  /* ---- cashing out ----
     The room does two things and only two: it says WHICH account (the seat's
     connecting address, above), and it banks the current run first so the
     kills of the last five minutes count. The ledger decides everything else,
     and London does the paying. */
  private async onClaim(seat: Seat, m: Extract<ClientMessage, { t: "claim" }>): Promise<void> {
    if (!seat.joined) return;
    const now = this.now;
    if (now - seat.lastClaim < 5) return;
    seat.lastClaim = now;
    const to = typeof m.to === "string" ? m.to.slice(0, 40) : "";
    await this.bank(seat);
    /* A web guest's DIVI is real and stays banked, but paying it out waits for
       a signed-in account (identity.ts). */
    if (!mayCashOut(seat)) {
      await this.sendPurse(seat);
      return;
    }
    const purse = await requestCashOut(this.env.LEDGER as unknown as LedgerBinding, seat.account, to);
    this.send(seat, { t: "purse", ...(purse as object) } as ServerMessage);
  }

  private async sendPurse(seat: Seat, why?: string): Promise<void> {
    if (!seat.joined) return;
    const purse = await readPurse(this.env.LEDGER as unknown as LedgerBinding, seat.account);
    /* Nothing to show yet: the panel asks again when it opens. */
    if (!purse) return;
    /* A guest sees what is banked, never an amount offered to cash out, and
       always sees why. */
    if (!mayCashOut(seat)) {
      purse.claimable = 0;
      purse.why = GUEST_CASH_OUT;
    }
    if (why) purse.why = why;
    this.send(seat, { t: "purse", ...(purse as object) } as ServerMessage);
  }

  /**
   * A cockpit saying where it is.
   *
   * Two things are checked, and they are the two that matter while flight is
   * still client-side. Could it have GOT there since its last report, at the
   * fastest the ship flies? And is it inside the world at all? Anything else —
   * a heading that snaps, a turn no stick could make — is a matter of feel,
   * costs nothing to score, and is not worth refusing a connection over.
   */
  private onTransform(seat: Seat, m: Extract<ClientMessage, { t: "tf" }>): void {
    if (!seat.joined) return;

    /* No more often than a tick and a half. A client sending faster is either
       broken or trying to outrun the checks below by shrinking each step. */
    if (this.now - seat.tfWindow > 1) { seat.tfWindow = this.now; seat.tfCount = 0; }
    if (++seat.tfCount > HZ * 2) return;

    const p = vec(m.p), f = vec(m.f);
    if (!p || !f || f.lengthSq() < 1e-6) return this.strike(seat, "bad transform");

    /* The world got a great deal taller when the flight model was freed: the
       ceiling went from thirty units to eight planet radii, so a player really
       can be out in space. The bound follows it rather than being a number of
       its own, or honest pilots would start being snapped back the moment they
       climbed. */
    const alt = p.length();
    if (alt < R + MIN_ALT - 2 || alt > R + MAX_ALT + 2) {
      return this.snapBack(seat, "outside the world");
    }

    /* The budget is the fastest the ship goes, times the time since the last
       accepted report, with half a second of slack for a stalled frame or a
       late packet. Being generous here is deliberate: a false refusal is a
       player teleporting backwards through no fault of their own, which is a
       far worse bug than someone gaining a few units. */
    const since = Math.max(DT, this.now - (seat as { lastTf?: number }).lastTf!) || DT;
    /* Against what THIS ship can do: super boost and the slides count. */
    const budget = seat.topSpeed * (since + 0.5) * 1.25;
    if (seat.body.pos.distanceTo(p) > budget) {
      return this.snapBack(seat, "moved too far");
    }

    seat.body.pos.copy(p);
    seat.body.fwd.copy(f).normalize();
    seat.wantGuard = m.g === 1;
    (seat as { lastTf?: number }).lastTf = this.now;
  }

  private snapBack(seat: Seat, why: string): void {
    seat.strikes++;
    this.send(seat, {
      t: "no", why,
      p: [r1(seat.body.pos.x), r1(seat.body.pos.y), r1(seat.body.pos.z)],
    });
    if (seat.strikes > 40) this.kick(seat, why);
  }

  /**
   * A cockpit pulling a trigger.
   *
   * It says WHEN and FROM WHERE. The room decides whether there was a round in
   * the magazine, whether the guns had cooled, and what the round then does.
   * A client cannot fire what it does not have, cannot fire faster than the
   * weapon does, and never gets to say what it hit.
   */
  private onFire(seat: Seat, m: Extract<ClientMessage, { t: "fire" }>): void {
    if (!seat.joined || seat.dead) return;
    const p = vec(m.p), f = vec(m.f);
    if (!p || !f || f.lengthSq() < 1e-6) return this.strike(seat, "bad shot");
    f.normalize();

    /* ---- WHERE A SHOT COMES FROM ----
       From where the cockpit says, when that is anywhere near where the room
       thinks the ship is, because the room's copy is up to a report behind
       and a round that leaves from fifty milliseconds ago reads as a gun
       that is off.
 
       When it is NOT near, the shot is fired from the room's own position
       rather than refused. Refusing was a disaster: the check was six units,
       a ship at super boost covers two in a report and four more in a lag
       spike, and one refused transform left the room's copy of the position
       behind for good. From then on every shot, beam and torpedo was thrown
       away with "shot from elsewhere", and a player watched their guns stop
       working for the rest of the flight. Geoff, 2026-Sep-13: "I don't see
       any bullets anymore. The beam doesn't show and so that's broken too...
       Torpedoes still only explode inside the cockpit."
 
       And it is never refused, at any distance. Firing from the room's own
       position is always safe: the origin is a number the room chose, so a
       client claiming to be anywhere gains nothing at all by it. Refusing
       bought no safety and cost a player their guns. Where a ship IS gets
       corrected in onTransform, which is where that belongs. */
    const slack = Math.max(12, seat.topSpeed * 0.4);
    const from = p.distanceTo(seat.body.pos) <= slack ? p : seat.body.pos.clone();

    /* The ship's own up when given, else away from the planet. */
    const shipUp = vec(m.u);
    const up = shipUp && shipUp.lengthSq() > 1e-6 ? shipUp.normalize() : from.clone().normalize();
    if (m.k === "main") {
      if (this.now - seat.lastMain < 0.075) return;   /* the gun's own cooldown */
      if (seat.ammo < 1) return;
      seat.lastMain = this.now;
      seat.ammo -= 1;
      fireGuns(this.combat, from, f, up, 70, 1.6, seat.id);
      /* ---- IN UNISON ----
         Every wingman with a round left fires from where it is, at what its
         owner is aiming at, for its tier's share of a round's damage. The
         mini gun and the beams are the player's alone: eight streams at
         twenty rounds a second would be a wall rather than a wingman. */
      for (const wing of seat.wings) {
        if (wing.hull <= 0 || wing.ammo < 1) continue;
        wing.ammo -= 1;
        const aim = _wingAim.copy(from).addScaledVector(f, CONVERGE).sub(wing.pos).normalize();
        pushBullet(this.combat, {
          pos: wing.pos.clone(),
          vel: aim.clone().multiplyScalar(BULLET_SPEED),
          life: BULLET_LIFE,
          hostile: false,
          owner: seat.id,
          scale: wingShare(wing.tier),
        });
      }
    } else if (m.k === "mini") {
      if (!seat.gear.has("mini")) return this.send(seat, { t: "no", why: "no minigun on this ship" });
      if (this.now - seat.lastMini < MINI_INTERVAL * 0.9) return;
      if (seat.ammo < MINI_AMMO) return;
      seat.lastMini = this.now;
      seat.ammo -= MINI_AMMO;
      const aim = vec(m.a) ?? f;
      /* The ship's RIGHT: up crossed with forward. It was forward crossed
         with up, which is the left, so the stream came from the wrong
         corner of the frame. */
      const right = new THREE.Vector3().crossVectors(up, f).normalize();
      const muzzle = new THREE.Vector3();
      /* The helper measures the corner in a camera frame; the room has no
         camera, so the ship's own frame stands in. It was being called with
         the OLD argument list after the corner was moved into camera space,
         which put a number where a vector goes and threw on every mini-gun
         message the room received. */
      miniMuzzle(from, f, right, up, 70, 1.6, muzzle);
      fireMini(this.combat, muzzle, from, aim.normalize(), seat.id);
    } else if (m.k === "torp") {
      if (this.now - seat.lastTorp < 0.5) return;
      if (seat.torps < 1) return;
      seat.lastTorp = this.now;
      seat.torps -= 1;
      fireTorpedo(this.combat, from, f, seat.id);
    } else if (m.k === "beam") {
      /* The beam the client named, if it declared it. Same burst length and
         cost as the solo game, so a beam in company is the beam alone. */
      const spec = typeof m.w === "string" ? weaponByKey(m.w) : null;
      if (!spec || spec.kind !== "beam") return this.strike(seat, "unknown weapon");
      if (!seat.gear.has(spec.key)) return this.send(seat, { t: "no", why: `no ${spec.name} on this ship` });
      if (this.now - seat.lastBeam < BEAM_SECONDS * 0.9) return;
      if (seat.ammo < BEAM_AMMO) return;
      seat.lastBeam = this.now;
      seat.ammo -= BEAM_AMMO;
      fireBeam(this.combat, spec, from, f, seat.id, seat.bonusUntil > this.now ? STAKE_BONUS : 1);
    } else {
      return this.strike(seat, "unknown weapon");
    }
    this.sendYou(seat);
  }

  private onDetonate(seat: Seat): void {
    if (!seat.joined || seat.dead) return;
    detonateOldest(this.combat, this.world, seat.id);
  }

  /* ---- the tower ----
     The cockpit runs the docking (the approach, the four seconds, the
     tether) and says when it finished; the room refills the seat if the ship
     is indeed beside a tower. The room's numbers are the ones the cockpit
     shows in company, so without this a resupply refilled nothing: Geoff,
     "going to my tower didn't replenish my ammo... my tower stopped
     working." Generous on the distance, because the room's position is a
     report behind. */
  private onDock(seat: Seat): void {
    if (!seat.joined || seat.dead) return;
    if (this.now - seat.lastDock < DOCK_SECONDS * 0.8) return;
    /* ---- YOUR OWN TOWER ----
       Measured to the mast of the tower this player joined from. It used to
       be measured against the room's own tower list, which NOTHING has ever
       filled in: setTips exists and nobody calls it, so the list was always
       empty, every dock was refused, and the resupply a player watched was
       the cockpit's animation and nothing more. Their real hull and ammo
       came back the moment the animation stopped hiding the gauges, which
       is why a trip to the tower could be followed by dying in clear sky.
       Geoff, 2026-Sep-12. */
    const near = Math.min(
      distanceToTower(seat.body.pos, seat.homeTip),
      /* A launch halves every tower, so the mast reported before launch is
         twice the height of the one being flown to. Measuring to the foot as
         well covers both, and erring generous here costs nothing: the worst
         case is a resupply granted a few units early at your own front
         door. */
      seat.body.pos.distanceTo(seat.home),
    );
    if (near > DOCK_RANGE * 2.5) return this.send(seat, { t: "no", why: "not at a tower" });
    seat.lastDock = this.now;
    seat.shield = Math.max(seat.shield, seat.shieldMax);
    seat.ammo = Math.max(seat.ammo, seat.ammoMax);
    seat.torps = Math.max(seat.torps, seat.torpsMax);
    seat.guards = Math.max(seat.guards, MAX_GUARDS);
    this.sendYou(seat);
  }

  /* ---- what the ship carries ----
     Declared on join and again whenever it changes, because a gun bought or
     a sphere opened in the middle of a flight has to take effect without
     relaunching. The maxima move; what is in the magazine right now does
     NOT, or buying a bigger magazine would be a free refill. */
  private applyGear(seat: Seat, list: unknown[], refill: boolean, drones?: unknown): void {
    seat.gear = new Set(
      list.slice(0, 64)
        .filter((k): k is string => typeof k === "string" && (!!weaponByKey(k) || ALL_ITEMS.some((i) => i.key === k))),
    );
    const gearList = [...seat.gear];
    const extras: Extras = {
      torpedoes: torpedoBonus(gearList), magazine: magBonus(gearList),
      superMult: superBoostMult(gearList, SUPER_BOOST_MULT), strafeMult: strafeMult(gearList),
      vstrafeMult: vstrafeMult(gearList), hullMult: hullMult(gearList),
    };
    seat.extras = extras;
    seat.ammoMax = ammoFor(extras);
    seat.torpsMax = torpedoesFor(extras);
    seat.shieldMax = shieldMaxFor(extras);
    seat.topSpeed = topSpeedFor(extras);
    if (refill) {
      seat.ammo = seat.ammoMax;
      seat.torps = seat.torpsMax;
      seat.shield = seat.shieldMax;
    }
    this.fitWings(seat, drones, refill);
  }

  /**
   * Give this seat the wingmen its account holds.
   *
   * A wingman already in a place keeps what is left of it when the
   * declaration has not changed that place, or a player could heal the
   * formation by saying the same thing twice. Anything new starts whole.
   */
  private fitWings(seat: Seat, drones: unknown, refill: boolean): void {
    const counts: Record<string, number> = {};
    if (Array.isArray(drones)) {
      for (let i = 0; i < Math.min(7, drones.length); i++) {
        const n = Number(drones[i]);
        if (Number.isFinite(n) && n > 0) counts[`drone${i + 1}`] = Math.min(WING_MAX, Math.floor(n));
      }
    }
    const tiers = wingTiers(counts);
    const was = seat.wings;
    seat.wings = tiers.map((tier, slot) => {
      const hullMax = Math.round(seat.shieldMax * wingShare(tier));
      const ammoMax = Math.round(seat.ammoMax * wingRounds(tier));
      const before = was.find((x) => x.slot === slot && x.tier === tier);
      return {
        slot, tier, hullMax, ammoMax,
        hull: before && !refill ? Math.min(before.hull, hullMax) : hullMax,
        ammo: before && !refill ? Math.min(before.ammo, ammoMax) : ammoMax,
        pos: before ? before.pos : new THREE.Vector3().copy(seat.body.pos),
      };
    });
  }

  static GEAR_GAP = 1;
  private onGear(seat: Seat, m: Extract<ClientMessage, { t: "gear" }>): void {
    if (!seat.joined) return;
    if (this.now - seat.lastGear < RebelsRoom.GEAR_GAP) return;
    seat.lastGear = this.now;
    if (m.reach !== undefined) seat.body.reach = clampReach(Number(m.reach));
    this.applyGear(seat, Array.isArray(m.gear) ? m.gear : [], false, m.drones);
    this.sendYou(seat);
  }

  /* ---- flying into things ----
     The ground and the towers are the FLIGHT MODEL's business: it owns the
     bounce, the drag along the surface and how much a given angle and speed
     costs, and there is one copy of that and it runs in the cockpit. So the
     cockpit reports the damage and the room applies it to the seat, which is
     the only place a hull number is kept.

     Stated plainly, because it is the one damage in the game the shooter
     declares: a client that never sent this would never take crash damage.
     It cannot gain anything by it, only decline to be hurt, which is the
     same standing the gear has. The amount is capped per second so a broken
     or malicious client cannot empty its own hull either. */
  static HURT_PER_SECOND = CRASH_DAMAGE * 4;
  private onHurt(seat: Seat, m: Extract<ClientMessage, { t: "hurt" }>): void {
    if (!seat.joined || seat.dead) return;
    const d = Number(m.d);
    if (!Number.isFinite(d) || d <= 0) return;
    if (this.now - seat.hurtWindow > 1) { seat.hurtWindow = this.now; seat.hurtSpent = 0; }
    const room = Math.max(0, RebelsRoom.HURT_PER_SECOND - seat.hurtSpent);
    const take = Math.min(d, room);
    if (take <= 0) return;
    seat.hurtSpent += take;
    seat.shield -= take;
    this.combat.events.push({ kind: "playerHit", at: seat.body.pos.clone(), power: 1.4, who: seat.id, damage: take });
    if (seat.shield <= 0) this.down(seat);
    else this.sendYou(seat);
  }

  /* ---- the stake bonus ----
     Winning a stake on your own node is worth a minute of triple damage.
     Only the wallet knows it happened, so it says so and the room takes it
     on trust, the same trust the gear gets. What the room does NOT do is
     take its word on how OFTEN: a fresh minute can be claimed no more than
     once every five, which is about the fastest an honest node could win,
     so a client repeating the message gains nothing much. */
  static BONUS_GAP = 300;
  private onBonus(seat: Seat): void {
    if (!seat.joined) return;
    if (this.now - seat.lastBonus < RebelsRoom.BONUS_GAP) return;
    seat.lastBonus = this.now;
    seat.bonusUntil = this.now + STAKE_BONUS_MS / 1000;
    this.sendYou(seat);
  }

  /* ---- test cheats ----
     The spawning itself lives in cheats.ts. What the room decides here is WHO
     may: never a web guest. The public page carries no cheat code, but a
     message can be typed into any browser's console, and "21" is a real dragon
     that leaves a real egg. App seats keep them for testing; with sign-in they
     become admin-only. */
  private onCheat(seat: Seat, m: Extract<ClientMessage, { t: "cheat" }>): void {
    if (!seat.joined || seat.dead) return;
    if (!mayCheat(seat)) return;
    runRoomCheat(this.combat, seat.body, String(m.code ?? ""));
  }

  /* Y: a held Instant Recharge or Supercharge. The room does not hold the
     inventory (the account row does), so it cannot count them; what it can
     do is the same as for gear, refuse the malformed and pace it: one every
     two seconds, which is all an honest player could ever want. */
  static USE_GAP = 2;
  private onUse(seat: Seat, m: Extract<ClientMessage, { t: "use" }>): void {
    if (!seat.joined || seat.dead) return;
    if (m.k !== "recharge" && m.k !== "supercharge") return this.send(seat, { t: "no", why: "no such item" });
    if (this.now - seat.lastUse < RebelsRoom.USE_GAP) return;
    seat.lastUse = this.now;
    const g = { shields: seat.shield, ammo: seat.ammo, torpedoes: seat.torps, guards: seat.guards };
    if (m.k === "recharge") recharge(g, seat.extras); else supercharge(g, seat.extras);
    seat.shield = g.shields; seat.ammo = g.ammo; seat.torps = g.torpedoes; seat.guards = g.guards;
    this.sendYou(seat);
  }

  /* ---- discipline ----
     A strike is for a message that should not exist at all, as opposed to one
     that is merely refused. Enough of them and the socket goes: a client
     sending malformed frames in a loop is either broken or probing, and either
     way it is costing the room. */
  private strike(seat: Seat, why: string): void {
    seat.strikes++;
    if (seat.strikes > 20) return this.kick(seat, why);
    this.send(seat, { t: "no", why });
  }

  private kick(seat: Seat, why: string): void {
    try { seat.ws.close(1008, why.slice(0, 60)); } catch { /* already gone */ }
    this.leave(seat);
  }

  /* ---- messages out ---- */

  private send(seat: Seat, msg: ServerMessage): void {
    try { seat.ws.send(JSON.stringify(msg)); } catch { this.leave(seat); }
  }

  /**
   * Who is here, sent when that changes rather than every tick.
   *
   * A name and a paint scheme change about once a session. Putting them in the
   * twenty-times-a-second state message would be sending the same forty bytes
   * per player four thousand times a minute to say nothing at all.
   */
  private sendRoster(): void {
    const players = [...this.seats.values()].filter((s) => s.joined).map((s) => ({
      id: s.id, name: s.name, node: s.node, ship: s.ship,
      ...(s.paint ? { paint: s.paint } : {}),
    }));
    const wire = JSON.stringify({ t: "who", players });
    for (const s of this.seats.values()) {
      try { s.ws.send(wire); } catch { this.leave(s); }
    }
  }

  private sendYou(seat: Seat): void {
    this.send(seat, {
      t: "you",
      shield: Math.max(0, Math.round(seat.shield)),
      ammo: Math.round(seat.ammo * 4) / 4,
      torps: seat.torps,
      guards: seat.guards,
      score: seat.score,
      kills: seat.kills,
      divi: Math.floor(seat.divi),
      ...(seat.bonusUntil > this.now ? { bonus: Math.ceil(seat.bonusUntil - this.now) } : {}),
      ...(seat.dead ? { dead: 1 as const, respawn: Math.ceil(seat.respawn) } : {}),
    });
  }

  private broadcastState(): void {
    /* The picture for each player is built in broadcast.ts; the room sends it. */
    for (const [s, text] of stateMessages(this.combat, [...this.seats.values()], this.tick)) {
      try { s.ws.send(text); } catch { this.leave(s); }
    }
    /* Gauges every half second rather than every tick: they change slowly and
       they are the one message that is different for every player. */
    if (this.tick % (HZ / 2) === 0) for (const s of this.seats.values()) this.sendYou(s);
  }

  /** The room's own tower list, handed over once by the first player to join a
   *  fresh room. Towers are public map data, so there is nothing to protect
   *  here beyond sanity. */
  setTips(list: Vec[]): void {
    this.tips.length = 0;
    for (const v of list.slice(0, 4000)) {
      const p = vec(v);
      if (p) this.tips.push(p);
    }
  }
}

/** A vector off the wire, or null if it is not one. Every number that arrives
 *  from a client goes through here. */
/**
 * A paint scheme off the wire, made safe.
 *
 * Every number clamped into its own range and the shape checked exactly, since
 * this is echoed from one client to every other one. A hue of Infinity or a
 * hundred-element array from one bad cockpit must not become twenty broken
 * ships. Anything that is not exactly right is dropped rather than repaired:
 * the factory scheme is a perfectly good fallback and guessing at what a
 * malformed message meant is how a validator becomes a bug.
 */
function cleanPaint(raw: unknown): PaintWire | undefined {
  if (!Array.isArray(raw) || raw.length !== 5) return undefined;
  const out: PaintPart[] = [];
  for (const part of raw) {
    if (!Array.isArray(part) || part.length !== 4) return undefined;
    const n = part.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : NaN));
    if (n.some(Number.isNaN)) return undefined;
    out.push([
      ((n[0] % 360) + 360) % 360,
      Math.max(0, Math.min(1, n[1])),
      Math.max(0, Math.min(6, n[2])),
      Math.max(0, Math.min(3, Math.round(n[3]))),
    ]);
  }
  return out as PaintWire;
}

function vec(v: unknown): THREE.Vector3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > 1e5 || Math.abs(y) > 1e5 || Math.abs(z) > 1e5) return null;
  return new THREE.Vector3(x, y, z);
}

export { KILLS_PER_PAYOUT, DIVI_PER_PAYOUT, COIN_PER_KILL, COIN_VALUE };
