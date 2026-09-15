// The cockpit screen, drawn for every kind of moment, against a recording.
//
// Run: sh scripts/run-rebels-hud-tests.sh
//
// The cockpit is drawn to plain HTML for a list of situations (waiting for the
// globe, ready, connecting, flying, docked, near a world, rear view, a note up,
// offline, dead, broken) and compared with golden/hud-render-v1.json. That
// recording was made BEFORE the cockpit was split into pieces (G8, 2026-Sep-15),
// so a pass means the pieces put back together draw exactly what the one file
// drew. Record again only on purpose (HUD_GOLDEN_RECORD=1).

export {};
import { readFileSync, writeFileSync } from "node:fs";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; },
};
(globalThis as Record<string, unknown>).window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as Record<string, unknown>).Event = class { type: string; constructor(t: string) { this.type = t; } };

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

async function main() {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RebelsHud } = await import("./RebelsHud");
  type Hud = import("./rebelsController").HudState;
  type Ctl = import("./rebelsController").RebelsController;

  const base: Hud = {
    ready: false, speed: 0, alt: 0, shields: 2000, shieldMax: 2000, ammo: 120,
    torpedoes: 4, inFlight: 0, hitAt: 0, guards: 3, guarding: false, boost: 1,
    dock: 0, dockName: "", homeName: "London, UK", homeDist: 0, towers: 0, view: 0, throttle: 1,
    room: "off", crew: 0, points: 0, fps: 0, simMs: 0, drawCalls: 0, pixelRatio: 0, flocks: 0, superBoost: false, superMult: 2,
    rear: false, rearAim: false,
    primary: 0, secondary: 0, note: "", noteAt: 0, nearby: null, contacts: 0, kills: 0, score: 0, nearTower: Infinity, dockBlock: "",
    wave: 0, waveAt: 0, respawnIn: 0,
    divi: 0, tierKills: new Array(7).fill(0), junk: 0, bonus: false, docked: false, dead: false, launched: false, broken: null,
  };
  const flying: Partial<Hud> = {
    ready: true, room: "live", launched: true, speed: 1.37, alt: 3.2, throttle: 0.8, towers: 212, homeDist: 4.4,
    shields: 1400, ammo: 87.25, torpedoes: 3, guards: 2, boost: 0.6, fps: 58, simMs: 2.34, drawCalls: 311, pixelRatio: 2,
    nearTower: 6.25, contacts: 2, kills: 14, score: 12345, divi: 3.456, points: 1234.9, tierKills: [9, 4, 1, 0, 0, 0, 0],
  };
  const states: [string, Partial<Hud>][] = [
    ["waiting for the globe", {}],
    ["ready, connecting", { ready: true, room: "connecting" }],
    ["ready, refused", { ready: true, room: "refused" }],
    ["ready, live", { ready: true, room: "live", homeName: "no node located" }],
    ["flying", flying],
    ["flying, reversing, on super boost, guarding", { ...flying, throttle: -0.5, superBoost: true, superMult: 3, guarding: true }],
    ["flying, low shields", { ...flying, shields: 300 }],
    ["flying, over-shielded", { ...flying, shields: 2600 }],
    ["flying, a wave, flocks, wreckage, a stake won, a torpedo out", { ...flying, wave: 3, waveAt: 1, flocks: 2, junk: 5, bonus: true, inFlight: 1, contacts: 1 }],
    ["flying, near a world", { ...flying, nearby: { name: "Mars", detail: "a world, 3 diameters" } }],
    ["flying, rear view", { ...flying, rear: true }],
    ["flying, firing backwards", { ...flying, rear: true, rearAim: true }],
    ["flying, a note up", { ...flying, note: "Mini Gun: buy it in SPACESHIPS", noteAt: Infinity }],
    ["flying, an old note", { ...flying, note: "stale", noteAt: -1e12 }],
    ["flying, reconnecting", { ...flying, room: "connecting" }],
    ["flying, lost the fight", { ...flying, room: "refused" }],
    ["docking", { ...flying, dock: 0.45, dockName: "Paris, FR" }],
    ["resupplied", { ...flying, dock: 1, dockName: "Paris, FR", docked: true }],
    ["dead, counting down", { ...flying, dead: true, respawnIn: 12.3 }],
    ["dead, ready to rejoin", { ...flying, dead: true, respawnIn: 0 }],
    ["dead, offline", { ...flying, dead: true, respawnIn: 0, room: "connecting" }],
    ["broken before launch", { broken: "no scene from the globe" }],
    ["broken in flight", { ...flying, broken: "a frame threw" }],
  ];

  const renders: { state: string; html: string }[] = [];
  for (const [name, patch] of states) {
    const h: Hud = { ...base, ...patch };
    const ctl = {
      cursor: () => ({ x: 0.5, y: 0.5 }), onEscape: () => {}, panel: () => {},
      hud: () => h, subscribe: () => () => {}, launch: () => {}, respawn: () => {}, dispose: () => {},
    } as unknown as Ctl;
    renders.push({ state: name, html: renderToStaticMarkup(React.createElement(RebelsHud, { ctl, onExit: () => {} })) });
  }
  ok("every situation draws", renders.every((r) => r.html.startsWith('<div class="orbit-hud"')), `${renders.length} situations`);
  ok("dying says YOU HAVE DIED", renders.filter((r) => r.html.includes('class="orbit-died" role="alert">YOU HAVE DIED<')).length === 3);

  const text = JSON.stringify(renders, null, 1);
  const GOLDEN = `${process.cwd()}/src/wallet/rebels/golden/hud-render-v1.json`;
  if (process.env.HUD_GOLDEN_RECORD === "1") {
    writeFileSync(GOLDEN, text + "\n");
    out.push(`RECORDED ${renders.length} situations`);
  } else {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as { state: string; html: string }[];
    for (const r of renders) {
      const g = golden.find((x) => x.state === r.state);
      const same = !!g && g.html === r.html;
      let where = "";
      if (!same && g) {
        let i = 0;
        while (i < r.html.length && r.html[i] === g.html[i]) i++;
        where = `at ${i}: now "${r.html.slice(i, i + 60)}" was "${g.html.slice(i, i + 60)}"`;
      }
      ok(`${r.state}: drawn exactly as recorded`, same, g ? where : "not in the recording");
    }
  }
  console.log(out.join("\n"));
  console.log(`\n${out.filter((l) => l.startsWith("PASS") || l.startsWith("RECORDED")).length} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}
void main();
