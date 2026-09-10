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

/** Everything the cockpit needs to know about somebody else in the room. */
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
  /** When this arrived, by the cockpit's clock. */
  at: number;
}

export interface Room {
  status(): RoomStatus;
  /** This cockpit's own seat, once the room has given it one. */
  me(): string;
  /** Everybody else. */
  others(): RoomPlayer[];
  /** The fight, as the room sees it. Overwritten every tick. */
  enemies: Array<{ pos: THREE.Vector3; fwd: THREE.Vector3; tier: number; shield: number; shieldMax: number; drone?: boolean }>;
  bullets: Array<{ pos: THREE.Vector3; vel: THREE.Vector3; hostile: boolean; mini: boolean }>;
  coins: Array<{ pos: THREE.Vector3 }>;
  wave: number;
  gauges: RoomGauges | null;
  /** Anything that happened this tick, for sound and sparks. Drained. */
  takeEvents(): RoomEvent[];
  /** Say where this ship is. Rate-limited inside. */
  report(pos: THREE.Vector3, fwd: THREE.Vector3, guard: boolean): void;
  fire(kind: "main" | "mini" | "torp" | "beam", pos: THREE.Vector3, fwd: THREE.Vector3, aim?: THREE.Vector3, weapon?: string): void;
  /** Beams in the air, as the room sees them. Overwritten every tick. */
  beams: Array<{ pos: THREE.Vector3; fwd: THREE.Vector3; life: number; half: number; reach: number; colour: number; key: string }>;
  detonate(): void;
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

/** Where the rooms live. */
export const ROOM_BASE = "wss://divi-rebels-room.geoff-de3.workers.dev";
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
  home: THREE.Vector3;
  ship: string;
  paint?: number[][];
  /** Weapon and item keys the player owns, so the room can arm the ship. */
  gear?: string[];
  /** Told when the connection comes up or goes down, for the cockpit's own
   *  display. */
  onStatus?: (s: RoomStatus) => void;
  /** Told whenever the ledger's view of this account arrives. */
  onPurse?: (p: Purse) => void;
}

export function joinRoom(opts: Opts): Room {
  let ws: WebSocket | null = null;
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
    bullets: [],
    coins: [],
    beams: [],
    wave: 0,
    gauges: null,
    takeEvents() { const out = events.slice(); events.length = 0; return out; },
    report(pos, fwd, guard) {
      if (!ws || status !== "live") return;
      if (sinceReport < 1 / REPORT_HZ) return;
      sinceReport = 0;
      send({ t: "tf", p: xyz(pos), f: xyz(fwd), ...(guard ? { g: 1 as const } : {}) });
    },
    fire(kind, pos, fwd, aim, weapon) {
      send({
        t: "fire", k: kind, p: xyz(pos), f: xyz(fwd),
        ...(aim ? { a: xyz(aim) } : {}), ...(weapon ? { w: weapon } : {}),
      });
    },
    detonate() { send({ t: "det" }); },
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
      if (closed) return;
      if (!ws && performance.now() >= retryAt) open();
    },
    close() {
      closed = true;
      setStatus("off");
      try { ws?.close(); } catch { /* already gone */ }
      ws = null;
    },
  };

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
      sock = new WebSocket(`${ROOM_BASE}/room/${ROOM_NAME}`);
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
        ...(opts.paint ? { paint: opts.paint } : {}),
        ...(opts.gear ? { gear: opts.gear } : {}),
      });
    };
    sock.onmessage = (ev) => {
      try { onMessage(JSON.parse(String(ev.data))); } catch { /* not ours */ }
    };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      players.clear();
      room.enemies.length = 0;
      room.bullets.length = 0;
      room.coins.length = 0;
      room.beams.length = 0;
      room.gauges = null;
      if (!closed) backoff();
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
      case "hi":
        seat = String(m.id ?? "");
        setStatus("live");
        return;

      case "who": {
        const list = Array.isArray(m.players) ? m.players : [];
        const keep = new Set<string>();
        for (const raw of list as Array<Record<string, unknown>>) {
          const id = String(raw.id ?? "");
          if (!id) continue;
          keep.add(id);
          const p = players_.get(id) ?? blank(id);
          p.name = String(raw.name ?? "").slice(0, 40);
          p.node = String(raw.node ?? "");
          p.ship = String(raw.ship ?? "");
          p.paint = Array.isArray(raw.paint) ? (raw.paint as number[][]) : undefined;
          players_.set(id, p);
        }
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
          tier: e[6], shield: e[7], shieldMax: e[8], drone: e[9] === 1,
        }));
        room.bullets = ((m.B ?? []) as number[][]).map((b) => ({
          pos: new THREE.Vector3(b[0], b[1], b[2]),
          vel: new THREE.Vector3(b[3], b[4], b[5]),
          hostile: b[6] === 1, mini: b[7] === 1,
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
          at: performance.now(),
        };
        room.purse = purse;
        opts.onPurse?.(purse);
        return;
      }

      case "no":
        /* The room refusing something. Kept quiet rather than swallowed
           entirely: it is where cheating and bugs look the same, and the black
           box is the right place for it. */
        events.push({
          kind: "denied", at: new THREE.Vector3(), power: 1,
          who: String(m.why ?? ""),
        });
        return;
    }
  }

  function blank(id: string): RoomPlayer {
    return {
      id, name: "", node: "", ship: "",
      pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1),
      from: new THREE.Vector3(), fromFwd: new THREE.Vector3(0, 0, 1),
      target: new THREE.Vector3(), targetFwd: new THREE.Vector3(0, 0, 1),
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
