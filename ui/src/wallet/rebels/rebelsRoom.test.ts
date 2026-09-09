// The cockpit's end of a room: joining, interpolating, and who is in it.
//
// Run: sh scripts/run-rebels-room-client-tests.sh
//
// The room server has been deployed and tested for a while. Nothing ever
// connected to it, which is why multiplayer has not worked: a server with no
// client is a server with no players. This is the half that was missing, so it
// is the half with no history of being right.

export {};

import * as THREE from "three";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
process.on("uncaughtException", (e) => {
  console.log(out.join("\n"));
  console.log("FAIL threw: " + (e as Error).message);
  process.exit(1);
});

/* ---- a socket that does what a real one does, including failing ---- */
const sent: string[] = [];
let sock: FakeSocket | null = null;
let opened = 0;
class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { opened++; sock = this; }
  send(s: string) { sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  /* Test helpers. */
  accept() { this.readyState = 1; this.onopen?.(); }
  deliver(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}
(globalThis as Record<string, unknown>).WebSocket = FakeSocket;
let clock = 0;
(globalThis as Record<string, unknown>).performance = { now: () => clock };

const last = () => JSON.parse(sent[sent.length - 1]);

async function main() {
  const R = await import("./rebelsRoom");
  const P = await import("./rebelsPeers");

  // 1. JOINING, and what it says about this ship.
  {
    sent.length = 0; opened = 0;
    const room = R.joinRoom({
      node: "1.2.3.4", name: "Geoff's node",
      home: new THREE.Vector3(0, 0, 100),
      ship: "space_SM_Ship_Fighter_04",
      paint: [[205, 0.52, 1, 0], [260, 0.07, 1, 2], [34, 0.68, 1, 0], [260, 0.04, 1, 0], [172, 1, 1, 3]],
    });
    ok("it opens a socket at once", opened === 1, `${opened}`);
    ok("and it is a websocket to the room", sock!.url.startsWith("wss://") && sock!.url.includes("/room/"),
       sock!.url);
    ok("nothing is sent before it is open", sent.length === 0, `${sent.length}`);

    sock!.accept();
    const join = last();
    ok("it joins", join.t === "join");
    ok("carrying who this is", join.node === "1.2.3.4" && join.name === "Geoff's node");

    /* ---- THE SHAPE ON THE WIRE ----
       An ARRAY of three numbers, which is what `type Vec` has always said and
       what the room has always validated. The first version of this client sent
       {x,y,z} and the room refused every single join with "bad home".

       No unit test caught that, and this one nearly did not: a mock server
       agrees with whatever mistake you have made, because you wrote both ends
       of it. Two real cockpits against the deployed room found it in one run.
       So the shape is asserted explicitly here rather than being implied by a
       fake that shares the bug. */
    ok("home is a vector in the protocol's shape",
       Array.isArray(join.home) && join.home.length === 3
       && join.home.every((n: unknown) => typeof n === "number"),
       JSON.stringify(join.home));
    /* The two that make a room look like a room rather than a row of identical
       grey arrows. */
    ok("and which hull they fly", join.ship === "space_SM_Ship_Fighter_04", String(join.ship));
    ok("and how it is painted", Array.isArray(join.paint) && join.paint.length === 5,
       JSON.stringify(join.paint));

    ok("it is not live until the room says so", room.status() === "connecting", room.status());
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    ok("and then it is", room.status() === "live", room.status());
    ok("with a seat of its own", room.me() === "s1", room.me());
    room.close();
  }

  // 2. WHO ELSE IS HERE, and what they look like.
  {
    sent.length = 0;
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x" });
    sock!.accept();
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    sock!.deliver({ t: "who", players: [
      { id: "s1", name: "me", node: "n", ship: "space_SM_Ship_Fighter_01" },
      { id: "s2", name: "Alice", node: "5.6.7.8", ship: "space_SM_Ship_Stealth_02",
        paint: [[10, 1, 1, 0], [20, 1, 1, 0], [30, 1, 1, 0], [40, 1, 1, 0], [50, 1, 1, 0]] },
    ] });

    const others = room.others();
    ok("everyone else is listed", others.length === 1, `${others.length}`);
    ok("but not this ship itself", !others.some((p) => p.id === "s1"));
    ok("with their name", others[0].name === "Alice", others[0].name);
    ok("their hull", others[0].ship === "space_SM_Ship_Stealth_02", others[0].ship);
    ok("and their paint", Array.isArray(others[0].paint) && others[0].paint!.length === 5);
    room.close();
  }

  // 3. THE FIGHT IS THE ROOM'S.
  {
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x" });
    sock!.accept();
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    sock!.deliver({
      t: "s", n: 5, w: 3,
      P: [["s1", 1, 2, 3, 0, 0, 1, 0, 900], ["s2", 10, 20, 30, 1, 0, 0, 1, 400]],
      E: [[5, 5, 5, 0, 0, 1, 2, 60, 130]],
      B: [[1, 1, 1, 9, 0, 0, 1, 0]],
      C: [[7, 7, 7]],
    });
    ok("the wave comes from the room", room.wave === 3, `${room.wave}`);
    ok("so do the fighters", room.enemies.length === 1 && room.enemies[0].tier === 2);
    ok("and their shields", room.enemies[0].shield === 60 && room.enemies[0].shieldMax === 130);
    ok("so do the rounds in the air", room.bullets.length === 1 && room.bullets[0].hostile);
    ok("and the coins", room.coins.length === 1);

    /* ---- the gauges, which are the whole reason the room exists ---- */
    sock!.deliver({ t: "you", shield: 1234, ammo: 55, torps: 2, guards: 9, score: 4321, kills: 7, divi: 3 });
    ok("the gauges are the room's", room.gauges?.shield === 1234 && room.gauges?.score === 4321,
       JSON.stringify(room.gauges));
    room.close();
  }

  // 4. SMOOTHING BETWEEN TICKS.
  //
  //    The room speaks twenty times a second and the screen draws sixty, so two
  //    frames in three have nothing new. Drawn straight off the wire, every
  //    other ship in the room steps rather than flies.
  {
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x" });
    sock!.accept();
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    sock!.deliver({ t: "s", n: 1, w: 0, P: [["s2", 0, 0, 100, 0, 0, 1, 0, 100]], E: [], B: [], C: [] });
    room.step(1);                       /* let it settle at the first report */
    const a = room.others()[0].pos.clone();
    sock!.deliver({ t: "s", n: 2, w: 0, P: [["s2", 0, 0, 140, 0, 0, 1, 0, 100]], E: [], B: [], C: [] });

    const straightAway = room.others()[0].pos.clone();
    ok("a new report does not teleport the ship", straightAway.distanceTo(a) < 1,
       `moved ${straightAway.distanceTo(a).toFixed(2)} on the frame it arrived`);

    room.step(0.02);
    const part = room.others()[0].pos.clone();
    ok("it moves part of the way on the next frame",
       part.distanceTo(a) > 1 && part.distanceTo(a) < 39,
       `${part.distanceTo(a).toFixed(1)} of 40`);

    room.step(1);
    ok("and arrives", room.others()[0].pos.distanceTo(new THREE.Vector3(0, 0, 140)) < 0.01,
       room.others()[0].pos.toArray().map((n) => n.toFixed(1)).join(","));
    room.close();
  }

  // 5. A SHIP THAT LEAVES STOPS BEING DRAWN.
  {
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x" });
    sock!.accept();
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    sock!.deliver({ t: "s", n: 1, w: 0, P: [["s2", 0, 0, 100, 0, 0, 1, 0, 100]], E: [], B: [], C: [] });
    ok("they are here", room.others().length === 1);
    sock!.deliver({ t: "s", n: 2, w: 0, P: [], E: [], B: [], C: [] });
    ok("and then they are not", room.others().length === 0, `${room.others().length}`);
    room.close();
  }

  // 6. REPORTING, and not flooding.
  {
    sent.length = 0;
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x" });
    sock!.accept();
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    sent.length = 0;
    const p = new THREE.Vector3(0, 0, 120);
    const f = new THREE.Vector3(1, 0, 0);
    /* Sixty frames of a second. The room ticks at twenty, so sending on every
       frame is sending the same tick three times. */
    for (let i = 0; i < 60; i++) { room.step(1 / 60); room.report(p, f, false); }
    const tf = sent.map((m) => JSON.parse(m)).filter((m) => m.t === "tf");
    ok("a second of flying is about twenty reports", tf.length >= 18 && tf.length <= 22, `${tf.length}`);
    ok("and each carries vectors the room will accept",
       Array.isArray(tf[0]?.p) && tf[0].p.length === 3 && Array.isArray(tf[0]?.f),
       JSON.stringify(tf[0]));
    room.close();
  }

  // 7. A ROOM THAT IS DOWN MUST NOT BE HAMMERED.
  //
  //    A client that reconnects once a frame turns one outage into a denial of
  //    service against its own server.
  {
    opened = 0; clock = 0;
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x" });
    ok("one attempt to begin with", opened === 1, `${opened}`);
    sock!.close();
    /* A whole second of frames while it is down. */
    for (let i = 0; i < 60; i++) { clock += 1000 / 60; room.step(1 / 60); }
    ok("it does not reconnect once a frame", opened <= 3, `${opened} attempts in a second`);
    ok("and it says so", room.status() === "retrying" || room.status() === "refused", room.status());

    /* And it does eventually come back. */
    clock += 60_000;
    room.step(1 / 60);
    ok("but it does keep trying", opened >= 2, `${opened}`);
    room.close();
    ok("closing stops it for good", room.status() === "off", room.status());
    const was = opened;
    clock += 60_000;
    room.step(1 / 60);
    ok("and it stays stopped", opened === was, `${opened} vs ${was}`);
  }

  // 8. PAINT SURVIVING THE ROUND TRIP.
  {
    const wire = [[205, 0.52, 1, 1], [260, 0.07, 2, 2], [34, 0.68, 0.5, 3], [260, 0.04, 1, 0], [172, 1, 6, 0]];
    const paint = P.paintFromWire(wire);
    ok("a scheme off the wire comes back whole",
       Math.abs(paint.hull1.hue - 205) < 1e-9 && Math.abs(paint.engine.bright - 6) < 1e-9,
       JSON.stringify(paint.hull1));
    ok("and the overlays with it",
       paint.hull1.overlay === "lines" && paint.hull2.overlay === "hex" && paint.accent.overlay === "camo",
       `${paint.hull1.overlay},${paint.hull2.overlay},${paint.accent.overlay}`);

    /* ---- ANTI-CHEAT: A PEER'S PAINT IS UNTRUSTED INPUT ----
       It is echoed by the room from another player's client, so it is exactly
       as trustworthy as that client is. Nothing here may become NaN, wrap a
       hue into infinity, or index off the end of the overlay list. */
    for (const bad of [
      undefined, null, [], [[1, 2, 3]], "nope", [[NaN, NaN, NaN, NaN], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      [[1e9, -5, 1e9, 99], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    ] as unknown[]) {
      const got = P.paintFromWire(bad as number[][]);
      const nums = Object.values(got).flatMap((v) => [v.hue, v.sat, v.bright]);
      const sane = nums.every((n) => Number.isFinite(n))
        && Object.values(got).every((v) => v.hue >= 0 && v.hue < 360 && v.sat >= 0 && v.sat <= 1
          && v.bright >= 0 && v.bright <= 6
          && ["none", "lines", "hex", "camo"].includes(v.overlay ?? "none"));
      ok(`nonsense paint (${JSON.stringify(bad)?.slice(0, 24)}) stays sane`, sane, JSON.stringify(got.hull1));
    }
  }

    /* ---- gear and beams on the wire ---- */
  {
    sock = null;
    const room = R.joinRoom({ node: "n", name: "me", home: new THREE.Vector3(0, 0, 100), ship: "x", gear: ["mini", "beam1"] });
    sock!.accept();
    const join = [...sent].reverse().map((x) => JSON.parse(x) as Record<string, unknown>).find((m) => m.t === "join") as Record<string, unknown>;
    ok("the join carries the gear", Array.isArray(join?.gear) && (join.gear as string[]).join(",") === "mini,beam1",
       JSON.stringify(join?.gear));
    sock!.deliver({ t: "hi", id: "s1", hz: 20 });
    room.fire("beam", new THREE.Vector3(0, 0, 108), new THREE.Vector3(0, 1, 0), undefined, "beam1");
    const shot = last() as Record<string, unknown>;
    ok("a beam names its weapon", shot?.k === "beam" && shot?.w === "beam1", JSON.stringify(shot));
    sock!.deliver({ t: "s", n: 1, w: 1, P: [], E: [], B: [], C: [],
      M: [[0, 0, 108, 0, 1, 0, "beam2", 0.4]] });
    ok("beams arrive with the weapon's own cone, reach and colour",
       room.beams.length === 1 && room.beams[0].key === "beam2" && room.beams[0].life === 0.4
       && room.beams[0].reach > 90 && room.beams[0].half > 0 && room.beams[0].fwd.y === 1,
       JSON.stringify(room.beams[0] ?? null));
    sock!.deliver({ t: "s", n: 2, w: 1, P: [], E: [], B: [], C: [] });
    ok("and are gone when the wire stops carrying them", room.beams.length === 0);
    room.close();
  }

  console.log(out.join("\n"));
  console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
