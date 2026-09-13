// The cockpit's end of a room.
//
// The room itself has existed and been deployed for a while, simulating the
// whole fight for everybody in it. Nothing ever talked to it. Geoff: "make
// multiplayer work.. there's no point in doing a build if people can't play
// together." This is the missing half.
//
// WHAT THE ROOM OWNS, AND WHAT THE COCKPIT KEEPS
// ----------------------------------------------
// Flying stays here. A ship that waited for a round trip before it turned would
// feel broken however good the connection was, so the stick still moves the
// ship at once and the position is reported afterwards.
//
// Everything else belongs to the room: the fighters, every round in the air,
// the coins, and above all the gauges. A shield, a score and a DIVI balance
// are never the cockpit's numbers while connected, because a cockpit that
// decides its own score is a cockpit that can be edited into deciding a better
// one. That is the whole reason the room exists.
//
// So while connected the local simulation is not stepped at all. Its lists are
// filled in from the wire instead and drawn exactly as before, which is what
// makes two players see the SAME fight rather than two private ones.

import * as THREE from "three";
import { weaponByKey } from "./weaponCatalog";
import { dflow } from "./rebelsDflow";
import { platform } from "./platform/current";
import { DEFAULT_ROOM_BASE } from "./platform/defaults";

/** Everything the cockpit needs to know about somebody else in the room. */
/** One round, as the room announced it. */
export interface Shot {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hostile: boolean;
  mini: boolean;
  orb: boolean;
  life: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  node: string;
  /** Their hull, and how they painted it. */
  ship: string;
  paint?: number[][];
  /** Where they are being drawn, where that move started, and where it is
   *  going: the room speaks twenty times a second and the screen draws sixty,
   *  so two frames in three have nothing new and a ship drawn straight from
   *  the wire jerks. */
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  from: THREE.Vector3;
  fromFwd: THREE.Vector3;
  target: THREE.Vector3;
  targetFwd: THREE.Vector3;
  /** How far through the interpolation, 0 to 1. */
  t: number;
  guard: boolean;
  shield: number;
  /** Cleared each state message; anyone not mentioned has gone. */
  seen: boolean;
}

/** The gauges, which are the room's and never the cockpit's. */
export interface RoomGauges {
  shield: number;
  ammo: number;
  torps: number;
  guards: number;
  score: number;
  kills: number;
  divi: number;
  dead: boolean;
  respawn: number;
  /** Seconds of triple damage left. */
  bonus: number;
}

export interface RoomEvent {
  kind: string;
  at: THREE.Vector3;
  power: number;
  who?: string;
  tier?: number;
  shield?: number;
  damage?: number;
  wave?: number;
  guarded?: boolean;
  /** gem / drop of an item: its catalogue key, and the gem's id. */
  item?: string;
  id?: string;
  /** denied only: `at` is where the room says this ship really is, and the
   *  cockpit is to move there. */
  snap?: true;
}

export type RoomStatus = "off" | "connecting" | "live" | "retrying" | "refused";

/** The account as the ledger has it. See PurseOut in the room's protocol. */
export interface Purse {
  divi: number;
  claimable: number;
  paid: number;
  pending: { to: string; amount: number; at: number } | null;
  last: { to: string; amount: number; txid?: string; error?: string; at: number } | null;
  /** Why the last claim was refused, when it was. */
  why?: string;
  /** Flock kills ever, and gems held per tier. */
  flocks: number;
  gems: number[];
  /** Items picked up in rooms, by key: the room's own count. */
  items: Record<string, number>;
  /** When this arrived, by the cockpit's clock. */
  at: number;
}

export interface Room {
  status(): RoomStatus;
  /** This cockpit's own seat, once the room has given it one. */
  me(): string;
  /** Everybody else. */
  others(): RoomPlayer[];
  /**
   * How many ships are in this world, including yours.
   *
   * From the ROSTER, not from what is on screen. Since the room started
   * sending each player only what is near them, the drawing list holds the
   * ships in view and nothing else, and counting that told a player flying
   * alone in a busy world that they were alone.
   */
  crew(): number;
  /** The fight, as the room sees it. Overwritten every tick. */
  enemies: Array<{ pos: THREE.Vector3; fwd: THREE.Vector3; tier: number; shield: number; shieldMax: number; drone?: boolean; dragon?: boolean; id?: number }>;
  /** Rounds fired since this was last drained, and rounds the room says
   *  stopped early. The cockpit flies everything in between itself, with the
   *  same simulation file the room uses. */
  takeShots(): Shot[];
  takeSpent(): number[];
  coins: Array<{ pos: THREE.Vector3 }>;
  /** Torpedoes in the air, the room's: drawn, never simulated here. */
  torpedoes: Array<{ pos: THREE.Vector3; vel: THREE.Vector3 }>;
  /** Wreckage, which is solid: a round that hits a piece is spent, so it has
   *  to be drawn or shots disappear against nothing. */
  junk: Array<{ pos: THREE.Vector3; rot: THREE.Vector3; kind: string }>;
  /** The wingmen flying formation on every ship in the room, this one's
   *  included. They point where their owner points. */
  wings: Array<{ owner: string; slot: number; pos: THREE.Vector3; hull: number; hullMax: number; tier: number }>;
  wave: number;
  gauges: RoomGauges | null;
  /** Anything that happened this tick, for sound and sparks. Drained. */
  takeEvents(): RoomEvent[];
  /** Say where this ship is. Rate-limited inside. */
  report(pos: THREE.Vector3, fwd: THREE.Vector3, guard: boolean): void;
  fire(kind: "main" | "mini" | "torp" | "beam", pos: THREE.Vector3, fwd: THREE.Vector3, aim?: THREE.Vector3, weapon?: string, up?: THREE.Vector3): void;
  /** Beams in the air, as the room sees them. Overwritten every tick. */
  beams: Array<{ pos: THREE.Vector3; fwd: THREE.Vector3; life: number; half: number; reach: number; colour: number; key: string }>;
  /** Gems in the world. The room's; they persist there. A dropped item
   *  carries its key, its owner and the seconds it is theirs alone. */
  gems: Array<{ id: string; tier: number; pos: THREE.Vector3; spin: number; item?: string; owner?: string; hidden?: number }>;
  detonate(): void;
  /** Y: a held recharge or supercharge, applied by the room. */
  use(k: "recharge" | "supercharge"): void;
  /**
   * LAUNCH was pressed.
   *
   * Joining the room and FLYING in it are two different things. The socket
   * opens when the map hands over its scene, so the connection is settled
   * before anybody launches, but the fight must not count a seat until its
   * player is actually in it, or the waves run around a ship parked on its pad
   * while the human reads the launch card. Flying alone, this also starts the
   * fight over, which is what makes a restart a restart.
   */
  fly(): void;
  /** The resupply finished at a tower: the room refills the seat, having
   *  checked the ship really is at one. */
  dock(): void;
  /** Test cheats, so the shared fight has the same ones as the solo one. */
  cheat(code: string): void;
  /** This node won a stake: a minute of triple damage, if the room allows it. */
  bonus(): void;
  /** What the ship carries, when it changes: a gun bought, a sphere opened. */
  gear(list: string[], reach?: number, drones?: number[]): void;
  /** The flight model hit the ground or a tower, and by how much. */
  hurt(amount: number): void;
  /** Ask to be paid what is banked, to this address. The answer comes back
   *  as a purse, with `why` set if it was refused. */
  claim(to: string): void;
  /** Ask for the purse again. */
  askPurse(): void;
  /** The last purse the room sent, if any. */
  purse: Purse | null;
  /** Advance the interpolation between ticks. */
  step(dt: number): void;
  close(): void;
}

/** Where the rooms live, unless the door says otherwise (platform().roomBase). */
export const ROOM_BASE = DEFAULT_ROOM_BASE;
/**
 * One world, not one per region.
 *
 * Geoff asked for people to be able to play together and did not ask for them
 * to be sorted first, so everybody shares "earth". It is one line to change and
 * the room name is already the object's identity on the server, so a private
 * room or a per-continent split is a name rather than a rewrite.
 */
export const ROOM_NAME = "earth";

/** How often the cockpit says where it is. The room ticks at twenty; sending
 *  faster than that is sending the same tick twice. */
const REPORT_HZ = 20;
/** Seconds to smooth another ship across, which is one room tick plus a little
 *  slack for the wire. Without it every other ship steps twenty times a second
 *  and reads as a slideshow. */
const SMOOTH = 0.075;

interface Opts {
  node: string;
  name: string;
  /** "web" when the player came in through divi.love/rebels. See JoinIn. */
  door?: "web";
  /** A web guest's own id, which their banked DIVI is kept under. See JoinIn. */
  guest?: string;
  home: THREE.Vector3;
  ship: string;
  paint?: number[][];
  /** Weapon and item keys the player owns, so the room can arm the ship. */
  gear?: string[];
  /** The hull's capture reach, half its wingspan in world units. */
  reach?: number;
  /** How many wingmen of each tier the account holds, tier one first. */
  drones?: number[];
  /** Told when the connection comes up or goes down, for the cockpit's own
   *  display. */
  onStatus?: (s: RoomStatus) => void;
  /** Told whenever the ledger's view of this account arrives. */
  onPurse?: (p: Purse) => void;
}

/** How long a hidden tab keeps its seat. A page left open in a background tab
 *  should not hold one of a room's places all afternoon; coming back to it
 *  reconnects in about a second. */
export const HIDDEN_RELEASE_MS = 3 * 60_000;

export function joinRoom(opts: Opts): Room {
  let ws: WebSocket | null = null;
  /* ---- which room ----
     "earth" first, always. A full room answers with the overflow room to try
     next (earth-2, earth-3...), and the socket goes straight there. After any
     ordinary disconnect it starts again from earth, so the shared world fills
     back up as people leave rather than everyone staying scattered. */
  let roomName = ROOM_NAME;
  let hopTo: string | null = null;
  /* ---- a hidden tab gives its seat back ---- */
  let resting = false;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  const onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      if (hiddenTimer) return;
      hiddenTimer = setTimeout(() => {
        hiddenTimer = null;
        resting = true;
        try { ws?.close(); } catch { /* already gone */ }
      }, HIDDEN_RELEASE_MS);
    } else {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      if (resting) { resting = false; retries = 0; retryAt = 0; }
    }
  };
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  let status: RoomStatus = "connecting";
  let seat = "";
  let closed = false;
  let retryAt = 0;
  let retries = 0;
  let sinceReport = 0;

  const players = new Map<string, RoomPlayer>();
  const events: RoomEvent[] = [];

  const room: Room = {
    status: () => status,
    me: () => seat,
    others: () => [...players.values()].filter((p) => p.id !== seat),
    enemies: [],
    crew() { return Math.max(1, roster.size); },
    takeShots() { const out = shots; shots = []; return out; },
    takeSpent() { const out = spent; spent = []; return out; },
    coins: [],
    torpedoes: [],
    junk: [],
    wings: [],
    beams: [],
    gems: [],
    wave: 0,
    gauges: null,
    takeEvents() { const out = events.slice(); events.length = 0; return out; },
    report(pos, fwd, guard) {
      if (!ws || status !== "live") return;
      if (sinceReport < 1 / REPORT_HZ) return;
      sinceReport = 0;
      send({ t: "tf", p: xyz(pos), f: dir(fwd), ...(guard ? { g: 1 as const } : {}) });
    },
    fire(kind, pos, fwd, aim, weapon, up) {
      send({
        t: "fire", k: kind, p: xyz(pos), f: dir(fwd),
        ...(aim ? { a: dir(aim) } : {}), ...(weapon ? { w: weapon } : {}), ...(up ? { u: dir(up) } : {}),
      });
    },
    detonate() { send({ t: "det" }); },
    use(k) { send({ t: "use", k }); },
    fly() { send({ t: "fly" }); },
    dock() { send({ t: "dock" }); },
    cheat(code) { send({ t: "cheat", code }); },
    bonus() { send({ t: "bonus" }); },
    gear(list, reach, drones) {
      send({
        t: "gear", gear: list,
        ...(reach ? { reach: Math.round(reach * 100) / 100 } : {}),
        ...(drones ? { drones } : {}),
      });
    },
    hurt(amount) { send({ t: "hurt", d: Math.round(amount * 100) / 100 }); },
    claim(to) { send({ t: "claim", to }); },
    askPurse() { send({ t: "purse" }); },
    purse: null,
    step(dt) {
      sinceReport += dt;
      /* Fill in between ticks. The room speaks twenty times a second and the
         screen draws sixty, so two frames in three have nothing new to show:
         without this every other ship in the room jerks. */
      for (const p of players.values()) {
        p.t = Math.min(1, p.t + dt / SMOOTH);
        p.pos.lerpVectors(p.from, p.target, p.t);
        p.fwd.lerpVectors(p.fromFwd, p.targetFwd, p.t).normalize();
      }
      if (closed || resting) return;
      if (!ws && performance.now() >= retryAt) open();
    },
    close() {
      closed = true;
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      setStatus("off");
      try { ws?.close(); } catch { /* already gone */ }
      ws = null;
    },
  };

  /* Rounds the room has told us about but the cockpit has not picked up
     yet. Drained once a frame; see takeShots. */
  /** Everyone in the world, by id: name, node, hull, paint. Outlives being
   *  out of view. */
  const roster = new Map<string, { id: string; name: string; node: string; ship: string; paint?: number[][] }>();
  let shots: Shot[] = [];
  let spent: number[] = [];

  const players_ = players;

  function setStatus(s: RoomStatus) {
    if (status === s) return;
    status = s;
    try { opts.onStatus?.(s); } catch { /* the cockpit's problem, not ours */ }
  }

  function send(msg: unknown): void {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* the close handler deals with it */ }
  }

  function open(): void {
    if (closed || ws) return;
    setStatus(retries === 0 ? "connecting" : "retrying");
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${platform().roomBase}/room/${roomName}`);
    } catch {
      backoff();
      return;
    }
    ws = sock;

    sock.onopen = () => {
      retries = 0;
      send({
        t: "join",
        node: opts.node,
        name: opts.name,
        home: xyz(opts.home),
        ship: opts.ship,
        ...(opts.door ? { door: opts.door } : {}),
        ...(opts.guest ? { guest: opts.guest } : {}),
        ...(opts.paint ? { paint: opts.paint } : {}),
        ...(opts.gear ? { gear: opts.gear } : {}),
        ...(opts.reach ? { reach: Math.round(opts.reach * 100) / 100 } : {}),
        ...(opts.drones && opts.drones.some((n) => n > 0) ? { drones: opts.drones } : {}),
      });
    };
    sock.onmessage = (ev) => {
      const text = String(ev.data);
      dflow.net(text.length, text.startsWith('{"t":"s"') ? text.length : undefined);
      try { onMessage(JSON.parse(String(ev.data))); } catch { /* not ours */ }
    };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      players.clear();
      room.enemies.length = 0;
      shots.length = 0;
      spent.length = 0;
      room.coins.length = 0;
      room.torpedoes.length = 0;
      room.junk.length = 0;
      room.wings.length = 0;
      room.beams.length = 0;
      room.gems.length = 0;
      room.gauges = null;
      if (closed) return;
      if (hopTo) {
        /* Sent on by a full room: go now, not after a backoff. */
        roomName = hopTo;
        hopTo = null;
        retries = 0;
        retryAt = 0;
        return;
      }
      /* Anything else starts over from the shared world. */
      roomName = ROOM_NAME;
      if (!resting) backoff();
    };
  }

  /**
   * Wait longer each time, up to about ten seconds.
   *
   * A room that is down, or a machine that has lost its network, must not be
   * hammered once a frame: that is a client that turns one outage into a
   * denial of service against its own server.
   */
  function backoff(): void {
    retries += 1;
    setStatus(retries > 6 ? "refused" : "retrying");
    retryAt = performance.now() + Math.min(10_000, 600 * Math.pow(1.8, Math.min(retries, 6)));
  }

  function onMessage(m: Record<string, unknown>): void {
    switch (m.t) {
      case "full": {
        /* This room is full. Try the one it names; if it names none, every
           overflow room is taken, so wait and try earth again. */
        const next = typeof m.next === "string" ? m.next : "";
        hopTo = /^earth(-\d{1,2})?$/.test(next) ? next : null;
        dflow.note(`room ${roomName} full${hopTo ? `, moving to ${hopTo}` : ", every room full"}`);
        return;
      }
      case "hi":
        seat = String(m.id ?? "");
        setStatus("live");
        return;

      case "who": {
        /* ---- THE ROSTER, WHICH IS NOT THE DRAWING LIST ----
           Who is in the world, with their name, hull and paint. It arrives
           when somebody joins or leaves, which is about once a session, so
           it cannot be rebuilt from what happens to be in view: a player who
           flies out of range and back would return with no name and the
           default grey ship until the next person joined. */
        const list = Array.isArray(m.players) ? m.players : [];
        const keep = new Set<string>();
        for (const raw of list as Array<Record<string, unknown>>) {
          const id = String(raw.id ?? "");
          if (!id) continue;
          keep.add(id);
          const who = roster.get(id) ?? { id, name: "", node: "", ship: "", paint: undefined as number[][] | undefined };
          who.name = String(raw.name ?? "").slice(0, 40);
          who.node = String(raw.node ?? "");
          who.ship = String(raw.ship ?? "");
          who.paint = Array.isArray(raw.paint) ? (raw.paint as number[][]) : undefined;
          roster.set(id, who);
          /* And anyone already on screen takes the new details at once. */
          const drawn = players_.get(id);
          if (drawn) { drawn.name = who.name; drawn.node = who.node; drawn.ship = who.ship; drawn.paint = who.paint; }
        }
        for (const id of [...roster.keys()]) if (!keep.has(id)) roster.delete(id);
        for (const id of [...players_.keys()]) if (!keep.has(id)) players_.delete(id);
        return;
      }

      case "s": {
        room.wave = Number(m.w) || 0;
        const P = (m.P ?? []) as Array<[string, number, number, number, number, number, number, number, number]>;
        for (const p of players_.values()) p.seen = false;
        for (const row of P) {
          const id = row[0];
          const p = players_.get(id) ?? blank(id);
          /* The newest report becomes the target and the CURRENT drawn
             position becomes the start, so a ship never jumps backwards to
             where it was a tick ago. */
          p.from.copy(p.pos);
          p.fromFwd.copy(p.fwd);
          p.target.set(row[1], row[2], row[3]);
          p.targetFwd.set(row[4], row[5], row[6]).normalize();
          /* A ship that has just appeared has nowhere to come from. */
          if (p.t >= 1 && p.from.lengthSq() === 0) { p.pos.copy(p.target); p.from.copy(p.target); }
          p.t = 0;
          p.guard = row[7] === 1;
          p.shield = row[8];
          p.seen = true;
          players_.set(id, p);
        }
        for (const [id, p] of [...players_.entries()]) if (!p.seen) players_.delete(id);

        room.enemies = ((m.E ?? []) as number[][]).map((e) => ({
          pos: new THREE.Vector3(e[0], e[1], e[2]),
          fwd: new THREE.Vector3(e[3], e[4], e[5]),
          tier: e[6], shield: e[7], shieldMax: e[8], drone: e[9] === 1, dragon: e[9] === 2, id: e[10] || 0,
        }));
        for (const f of (m.F ?? []) as number[][]) {
          shots.push({
            id: f[0],
            pos: new THREE.Vector3(f[1], f[2], f[3]),
            vel: new THREE.Vector3(f[4], f[5], f[6]),
            hostile: (f[7] & 1) !== 0,
            mini: (f[7] & 2) !== 0,
            orb: (f[7] & 4) !== 0,
            life: f[8],
          });
        }
        for (const id of (m.X ?? []) as number[]) spent.push(id);
        /* A long stall must not deliver a thousand rounds at once. */
        while (shots.length > 400) shots.shift();
        while (spent.length > 400) spent.shift();
        room.junk = ((m.J ?? []) as number[][]).map((j) => ({
          pos: new THREE.Vector3(j[0], j[1], j[2]),
          rot: new THREE.Vector3(j[3], j[4], j[5]),
          kind: j[6] === 1 ? "wingL" : j[6] === 2 ? "wingR" : "body",
        }));
        room.wings = ((m.W ?? []) as Array<[string, number, number, number, number, number, number, number]>).map((v) => ({
          owner: String(v[0]), slot: Number(v[1]) || 0,
          pos: new THREE.Vector3(v[2], v[3], v[4]),
          hull: Number(v[5]) || 0, hullMax: Number(v[6]) || 1, tier: Number(v[7]) || 1,
        }));
        room.torpedoes = ((m.T ?? []) as number[][]).map((t) => ({
          pos: new THREE.Vector3(t[0], t[1], t[2]),
          vel: new THREE.Vector3(t[3], t[4], t[5]),
        }));
        room.coins = ((m.C ?? []) as number[][]).map((k) => ({
          pos: new THREE.Vector3(k[0], k[1], k[2]),
        }));
        room.beams = ((m.M ?? []) as Array<[number, number, number, number, number, number, string, number]>).map((b) => {
          const spec = weaponByKey(String(b[6]));
          return {
            pos: new THREE.Vector3(b[0], b[1], b[2]),
            fwd: new THREE.Vector3(b[3], b[4], b[5]),
            life: Number(b[7]) || 0,
            half: ((spec?.cone ?? 2) * Math.PI) / 360,
            reach: spec?.reach ?? 90,
            colour: spec?.colour ?? 0xffd83a,
            key: String(b[6]),
          };
        });
        room.gems = ((m.G ?? []) as Array<[number, number, number, number, number, string, string?, string?, number?]>).map((g) => ({
          id: String(g[5]), tier: Number(g[3]) || 1,
          pos: new THREE.Vector3(g[0], g[1], g[2]), spin: Number(g[4]) || 0,
          ...(g[6] ? { item: String(g[6]), owner: String(g[7] ?? ""), hidden: Number(g[8]) || 0 } : {}),
        }));
        return;
      }

      case "you":
        room.gauges = {
          shield: Number(m.shield) || 0,
          ammo: Number(m.ammo) || 0,
          torps: Number(m.torps) || 0,
          guards: Number(m.guards) || 0,
          score: Number(m.score) || 0,
          kills: Number(m.kills) || 0,
          divi: Number(m.divi) || 0,
          dead: m.dead === 1,
          respawn: Number(m.respawn) || 0,
          bonus: Number(m.bonus) || 0,
        };
        return;

      case "e": {
        const v = (m.v ?? []) as Array<Record<string, unknown>>;
        for (const e of v) {
          const at = Array.isArray(e.at) ? (e.at as number[]) : [0, 0, 0];
          events.push({
            kind: String(e.k ?? ""),
            at: new THREE.Vector3(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0),
            power: Number(e.p) || 1,
            who: e.who ? String(e.who) : undefined,
            tier: e.tier as number | undefined,
            shield: e.sh as number | undefined,
            damage: e.dmg as number | undefined,
            wave: e.wave as number | undefined,
            guarded: e.g === 1,
            ...(typeof e.item === "string" ? { item: e.item } : {}),
            ...(typeof e.id === "string" ? { id: e.id } : {}),
          });
        }
        /* A long stall must not deliver a thousand bangs at once. */
        while (events.length > 60) events.shift();
        return;
      }

      case "purse": {
        const pending = m.pending && typeof m.pending === "object" ? m.pending as Record<string, unknown> : null;
        const last = m.last && typeof m.last === "object" ? m.last as Record<string, unknown> : null;
        const purse: Purse = {
          divi: Number(m.divi) || 0,
          claimable: Number(m.claimable) || 0,
          paid: Number(m.paid) || 0,
          pending: pending
            ? { to: String(pending.to ?? ""), amount: Number(pending.amount) || 0, at: Number(pending.at) || 0 }
            : null,
          last: last
            ? {
              to: String(last.to ?? ""), amount: Number(last.amount) || 0, at: Number(last.at) || 0,
              ...(last.txid ? { txid: String(last.txid) } : {}),
              ...(last.error ? { error: String(last.error) } : {}),
            }
            : null,
          ...(typeof m.why === "string" && m.why ? { why: m.why } : {}),
          flocks: Number(m.flocks) || 0,
          gems: Array.isArray(m.gems) ? (m.gems as unknown[]).map((n) => Number(n) || 0) : [0, 0, 0, 0, 0, 0, 0],
          items: m.items && typeof m.items === "object" ? Object.fromEntries(
            Object.entries(m.items as Record<string, unknown>).map(([k, v]) => [k, Number(v) || 0]),
          ) : {},
          at: performance.now(),
        };
        room.purse = purse;
        opts.onPurse?.(purse);
        return;
      }

      case "no": {
        /* ---- THE ROOM REFUSING SOMETHING ----
           And, when it comes with a position, TELLING YOU WHERE YOU ARE. That
           has to be obeyed. The room is the authority on where a ship is, and
           a cockpit that ignored the correction flew on while the room's copy
           of it stood still: the gap only ever grew, and every shot after
           that was refused for being fired from somewhere else. */
        const at = Array.isArray(m.p) ? (m.p as number[]) : null;
        events.push({
          kind: "denied", power: 1,
          at: at ? new THREE.Vector3(at[0], at[1], at[2]) : new THREE.Vector3(),
          who: String(m.why ?? ""),
          ...(at ? { snap: true as const } : {}),
        });
        return;
      }
    }
  }

  function blank(id: string): RoomPlayer {
    /* Their name and paint come from the roster, which outlives being out of
       view; only where they are is ephemeral. */
    const who = roster.get(id);
    return {
      id, name: who?.name ?? "", node: who?.node ?? "", ship: who?.ship ?? "",
      pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1),
      from: new THREE.Vector3(), fromFwd: new THREE.Vector3(0, 0, 1),
      target: new THREE.Vector3(), targetFwd: new THREE.Vector3(0, 0, 1),
      paint: who?.paint,
      t: 1, guard: false, shield: 0, seen: true,
    };
  }

  open();
  return room;
}

/**
 * A vector, in the shape the wire actually uses.
 *
 * An ARRAY, not an object. The first version of this sent {x,y,z} and the room
 * refused every single join with "bad home": the protocol has always said
 * `type Vec = [number, number, number]` and the server has always validated
 * exactly that. The unit tests could not catch it because they mocked the room,
 * and a mock agrees with whatever mistake you have made on both sides of it.
 * Two real cockpits against the deployed room found it in one run.
 */
function xyz(v: THREE.Vector3): [number, number, number] {
  return [round1(v.x), round1(v.y), round1(v.z)];
}
const round1 = (n: number) => Math.round(n * 10) / 10;
/* A DIRECTION is a unit vector: rounding it to a tenth per axis bends it by
   up to five degrees, which at the guns' convergence distance is a miss of
   several ship lengths. Geoff: "far off course." Four decimals is a tenth of
   a degree and three bytes more. */
export function dir(v: THREE.Vector3): [number, number, number] {
  return [round4(v.x), round4(v.y), round4(v.z)];
}
const round4 = (n: number) => Math.round(n * 10000) / 10000;
