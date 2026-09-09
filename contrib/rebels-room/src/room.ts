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
  createCombat, stepCombat, clearEvents, startWave,
  fireGuns, fireMini, fireTorpedo, detonateOldest, miniMuzzle,
  MINI_AMMO, MINI_INTERVAL, COIN_PER_KILL, COIN_VALUE,
  type CombatState, type CombatWorld, type PlayerBody,
} from "../../../ui/src/wallet/rebels/rebelsCombat";
import {
  MAX_SHIELD, MAX_AMMO, MAX_TORPEDOES, MAX_GUARDS, GUARD_SECONDS, GUARD_ABSORB,
  BOOST,
} from "../../../ui/src/wallet/rebels/orbitFlight";
import { R, MIN_ALT, MAX_ALT } from "../../../ui/src/wallet/rebels/orbitWorld";
import { r1, type ClientMessage, type ServerMessage, type Vec } from "./protocol";

/** Twenty ticks a second. Fast enough for dogfighting, cheap enough to run
 *  dozens of rooms; the cockpit interpolates between them. */
const HZ = 20;
const DT = 1 / HZ;

/** Hard ceiling on a room. Beyond this the sky is soup anyway. */
const MAX_SEATS = 24;

/** A single message may not be bigger than this. Nothing legitimate is. */
const MAX_FRAME = 2048;

/** Seconds on the ground after being shot down. Geoff's figure. */
const RESPAWN_SECONDS = 10;

/** A thousand kills is a hundred DIVI. */
const KILLS_PER_PAYOUT = 1000;
const DIVI_PER_PAYOUT = 100;

/* ---- what the room believes about one player ---- */
interface Seat {
  id: string;
  ws: WebSocket;
  node: string;
  name: string;
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
}

interface Env {
  ROOM: DurableObjectNamespace;
  LEDGER: DurableObjectNamespace;
}

export class RebelsRoom {
  private seats = new Map<string, Seat>();
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
      damageScale: 1,
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

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
      return new Response("room full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.seat(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---- seats ---- */

  private seat(ws: WebSocket): void {
    const id = `s${this.nextSeat++}`;
    const seat: Seat = {
      id, ws, node: "", name: "",
      home: new THREE.Vector3(0, 0, R),
      body: { id, pos: new THREE.Vector3(0, 0, R + 8), fwd: new THREE.Vector3(0, 1, 0), guard: false },
      shield: MAX_SHIELD, ammo: MAX_AMMO, torps: MAX_TORPEDOES,
      guards: MAX_GUARDS, guardFor: 0, wantGuard: false,
      score: 0, kills: 0, divi: 0,
      dead: false, respawn: 0,
      lastMain: -99, lastMini: -99, lastTorp: -99,
      tfWindow: 0, tfCount: 0, strikes: 0, joined: false,
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
    /* Whatever they earned is banked before the socket is forgotten, so
       closing the lid is not a way to lose someone else's money — or a way to
       keep yours out of the ledger's sight. */
    void this.bank(seat);
    this.refreshRoster();
    if (this.seats.size === 0) this.stop();
  }

  /* ---- the clock ---- */

  private start(): void {
    if (this.timer) return;
    this.combat = createCombat();
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
  }

  private refreshRoster(): void {
    const live: PlayerBody[] = [];
    for (const s of this.seats.values()) if (s.joined && !s.dead) live.push(s.body);
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
      }
    }

    this.refreshRoster();
    if (this.world.players!.length === 0) { clearEvents(this.combat); return; }

    stepCombat(this.combat, DT, this.world);
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
      });

      const who = ev.who ? this.seats.get(ev.who) : undefined;

      if (ev.kind === "enemyHit" && who) {
        /* Points are the damage that landed, exactly as in the solo game. */
        who.score += Math.round(ev.damage ?? 0);
      } else if (ev.kind === "enemyDown" && who) {
        who.kills += 1;
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
      /* Warnings are private: only the ship a round is aimed at hears its own.
         Everything else goes to everybody. */
      const shared = evs.filter((e) => e.k !== "incoming");
      for (const s of this.seats.values()) {
        const mine = evs.filter((e) => e.k === "incoming" && e.who === s.id);
        const list = mine.length > 0 ? [...shared, ...mine] : shared;
        if (list.length > 0) this.send(s, { t: "e", v: list as never });
      }
    }
  }

  private down(s: Seat): void {
    s.dead = true;
    s.respawn = RESPAWN_SECONDS;
    s.shield = 0;
    s.guardFor = 0;
    s.body.guard = false;
    /* Earnings survive death, as promised. Only the ship is lost. */
    void this.bank(s);
    this.refreshRoster();
  }

  private revive(s: Seat): void {
    s.dead = false;
    s.shield = MAX_SHIELD;
    s.ammo = MAX_AMMO;
    s.torps = MAX_TORPEDOES;
    s.guards = MAX_GUARDS;
    /* Back on your own pad, which is where a launch happens. */
    s.body.pos.copy(s.home).normalize().multiplyScalar(R + 8);
    this.refreshRoster();
  }

  /* ---- the ledger ----
     Kills and DIVI are reported to a single object that spans every room, since
     a player may fly in several over a week and the payout is one running
     total. The room is the only thing that ever writes to it. */
  private async bank(s: Seat): Promise<void> {
    if (!s.node || (s.kills === 0 && s.divi === 0 && s.score === 0)) return;
    const kills = s.kills, divi = s.divi, score = s.score;
    s.kills = 0; s.divi = 0; s.score = 0;
    try {
      const id = this.env.LEDGER.idFromName("v1");
      await this.env.LEDGER.get(id).fetch("https://ledger/credit", {
        method: "POST",
        body: JSON.stringify({ node: s.node, name: s.name, kills, divi, score }),
      });
    } catch {
      /* Put it back rather than lose it: the next flush will carry it. */
      s.kills += kills; s.divi += divi; s.score += score;
    }
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
    seat.home.copy(home).normalize().multiplyScalar(R);
    seat.body.pos.copy(seat.home).normalize().multiplyScalar(R + 8);
    seat.joined = true;
    this.refreshRoster();
    this.sendYou(seat);
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
    const budget = BOOST * (since + 0.5) * 1.25;
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

    /* Fired from where the room thinks they are, not from where the message
       says. Otherwise a shot could be taken from across the map. */
    if (p.distanceTo(seat.body.pos) > 6) return this.snapBack(seat, "shot from elsewhere");
    const from = seat.body.pos;

    if (m.k === "main") {
      if (this.now - seat.lastMain < 0.075) return;   /* the gun's own cooldown */
      if (seat.ammo < 1) return;
      seat.lastMain = this.now;
      seat.ammo -= 1;
      const up = from.clone().normalize();
      fireGuns(this.combat, from, f, up, 70, 1.6, seat.id);
    } else if (m.k === "mini") {
      if (this.now - seat.lastMini < MINI_INTERVAL * 0.9) return;
      if (seat.ammo < MINI_AMMO) return;
      seat.lastMini = this.now;
      seat.ammo -= MINI_AMMO;
      const aim = vec(m.a) ?? f;
      const up = from.clone().normalize();
      const muzzle = new THREE.Vector3();
      miniMuzzle(from, f, up, 70, 1.6, muzzle);
      fireMini(this.combat, muzzle, from, aim.normalize(), seat.id);
    } else if (m.k === "torp") {
      if (this.now - seat.lastTorp < 0.5) return;
      if (seat.torps < 1) return;
      seat.lastTorp = this.now;
      seat.torps -= 1;
      fireTorpedo(this.combat, from, f, seat.id);
    } else {
      return this.strike(seat, "unknown weapon");
    }
    this.sendYou(seat);
  }

  private onDetonate(seat: Seat): void {
    if (!seat.joined || seat.dead) return;
    detonateOldest(this.combat, this.world, seat.id);
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
      ...(seat.dead ? { dead: 1 as const, respawn: Math.ceil(seat.respawn) } : {}),
    });
  }

  private broadcastState(): void {
    const c = this.combat;
    const state = {
      t: "s" as const,
      n: this.tick,
      w: c.wave?.n ?? 0,
      P: [...this.seats.values()].filter((s) => s.joined).map((s) => [
        s.id, r1(s.body.pos.x), r1(s.body.pos.y), r1(s.body.pos.z),
        r1(s.body.fwd.x), r1(s.body.fwd.y), r1(s.body.fwd.z),
        s.body.guard ? 1 : 0, Math.max(0, Math.round(s.shield)),
      ]),
      E: c.enemies.map((e) => [
        r1(e.pos.x), r1(e.pos.y), r1(e.pos.z),
        r1(e.fwd.x), r1(e.fwd.y), r1(e.fwd.z),
        e.cls.tier, Math.max(0, Math.round(e.shield)), e.cls.shieldMax,
      ]),
      B: c.bullets.map((b) => [
        r1(b.pos.x), r1(b.pos.y), r1(b.pos.z),
        r1(b.vel.x), r1(b.vel.y), r1(b.vel.z),
        b.hostile ? 1 : 0, b.mini ? 1 : 0,
      ]),
      C: c.coins.map((k) => [r1(k.pos.x), r1(k.pos.y), r1(k.pos.z)]),
    };
    const wire = JSON.stringify(state);
    for (const s of this.seats.values()) {
      try { s.ws.send(wire); } catch { this.leave(s); }
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
function vec(v: unknown): THREE.Vector3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > 1e5 || Math.abs(y) > 1e5 || Math.abs(z) > 1e5) return null;
  return new THREE.Vector3(x, y, z);
}

export { KILLS_PER_PAYOUT, DIVI_PER_PAYOUT, COIN_PER_KILL, COIN_VALUE };
