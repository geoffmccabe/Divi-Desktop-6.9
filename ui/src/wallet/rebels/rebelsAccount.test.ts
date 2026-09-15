// Every request the game makes to the account database, recorded exactly.
//
// Run: sh scripts/run-rebels-account-tests.sh
//
// A fake network records the address, method, headers and body of every call the
// game's account functions make (scores, loadout, ships, forge, drop charts). The
// recording in golden/account-requests-v1.json was made BEFORE those calls were
// moved onto one account module (rebelsAccount.ts, 2026-Sep-15). If a request
// changes, the database functions it reaches may not accept it: record again
// only on purpose (ACCOUNT_GOLDEN_RECORD=1).

export {};
import { readFileSync, writeFileSync } from "node:fs";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; },
};
(globalThis as Record<string, unknown>).window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as Record<string, unknown>).Event = class { type: string; constructor(t: string) { this.type = t; } };
Date.now = () => 1789000000000;

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

type Seen = { call: string; url: string; method: string; headers: Record<string, string>; body: string | null };
const seen: Seen[] = [];
let current = "";
const answers: Record<string, unknown> = {};
const recorder = (async (url: string, init?: RequestInit) => {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const headers: Record<string, string> = {};
  for (const k of Object.keys(h).sort()) headers[k] = String(h[k]);
  seen.push({ call: current, url: String(url), method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : null });
  const key = Object.keys(answers).find((k) => String(url).includes(k));
  return new Response(JSON.stringify(key ? answers[key] : []), { status: 200, headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;
(globalThis as Record<string, unknown>).fetch = recorder;
const settle = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  const { setPlatform, HEADLESS } = await import("./platform/current");
  setPlatform({ ...HEADLESS, id: "test-golden", identity: { name: () => "Golden Node", joinFields: () => ({ node: "g", name: "Golden Node" }), accountKey: () => "Golden Node" } });
  const drops = await import("./dropConfigRemote");
  const { DEFAULT_DROP_CONFIG } = await import("./dropCharts");
  const loadout = await import("./rebelsLoadout");
  const scores = await import("./rebelsScores");
  const ships = await import("./rebelsShips");
  const forge = await import("./rebelsForge");
  const INV = await import("./rebelsInventory");
  const fleet = await import("./shipFleet");
  const { FACTORY } = await import("./shipColours");
  loadout.setLoadoutRemote(true);
  answers["rpc/rebels_forge"] = { result: "hull3", items: {} };

  current = "fetchDropConfig"; await drops.fetchDropConfig(recorder);
  current = "saveDropConfig"; await drops.saveDropConfig("s3cret", DEFAULT_DROP_CONFIG, recorder);
  current = "saveLoadoutRemote"; await loadout.saveLoadoutRemote();
  current = "loadLoadoutRemote"; await loadout.loadLoadoutRemote();
  INV.addHeld("hull2", 4);
  current = "forge"; await forge.forge("hull2", undefined, recorder);
  current = "recordScore"; scores.recordScore(1234, [1, 2, 0, 0, 0, 0, 0]); await settle();
  current = "fetchTop best"; await scores.fetchTop("best", 10);
  current = "fetchTop total"; await scores.fetchTop("total");
  current = "myTotals"; await scores.myTotals();
  current = "saveShip"; await ships.saveShip("space_SM_Ship_Cruiser_02", 2, { ...FACTORY }, "Nightjar", ["strafe2"]);
  current = "myFleet"; await ships.myFleet();
  INV.addHeld("strafe1", 1); fleet.applyToShip("space_SM_Ship_Fighter_01", "strafe1"); fleet.setShipName("space_SM_Ship_Fighter_01", "First");
  current = "saveFlyingShip"; await ships.saveFlyingShip("space_SM_Ship_Fighter_01");
  current = "pullFleet"; await ships.pullFleet();

  const text = JSON.stringify(seen, null, 1);
  const GOLDEN = `${process.cwd()}/src/wallet/rebels/golden/account-requests-v1.json`;
  if (process.env.ACCOUNT_GOLDEN_RECORD === "1") {
    writeFileSync(GOLDEN, text + "\n");
    out.push(`RECORDED ${seen.length} requests`);
  } else {
    const golden = readFileSync(GOLDEN, "utf8").trim();
    const calls = new Set(seen.map((s) => s.call));
    ok("every account function made its requests", calls.size >= 12, [...calls].join(", "));
    ok(`every request is identical to the recording (${seen.length} requests)`, text === golden,
       text === golden ? "" : (() => {
         const g = JSON.parse(golden) as Seen[];
         const i = seen.findIndex((s, n) => JSON.stringify(s) !== JSON.stringify(g[n]));
         return `first difference at request ${i}: ${JSON.stringify(seen[i])} vs ${JSON.stringify(g[i])}`;
       })());
  }
  console.log(out.join("\n"));
  console.log(`\n${out.filter((l) => l.startsWith("PASS") || l.startsWith("RECORDED")).length} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}
void main();
