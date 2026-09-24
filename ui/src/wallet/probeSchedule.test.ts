// Plain script, like the other map tests: run with scripts/run-probe-tests.sh.
let failed = 0;
const expect = (got: unknown) => ({
  toBe: (want: unknown) => { if (got !== want) { failed++; console.error("  FAIL: expected", want, "got", got); } },
  toEqual: (want: unknown) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a !== b) { failed++; console.error("  FAIL: expected", b, "got", a); } },
  toBeGreaterThan: (want: number) => { if (!((got as number) > want)) { failed++; console.error("  FAIL:", got, "not >", want); } },
  toBeLessThan: (want: number) => { if (!((got as number) < want)) { failed++; console.error("  FAIL:", got, "not <", want); } },
});
const describe = (name: string, f: () => void) => { console.log(name); f(); };
const it = (name: string, f: () => void) => { console.log("  -", name); f(); };
import {
  announcedName,
  assumedAlive,
  chunks,
  counts,
  firstWave,
  markDueNow,
  due,
  fresh,
  INTERVAL_MS,
  MISSES_BEFORE_DOWN,
  observe,
  plan,
  RECHECK_PER_PASS,
  TIMEOUT_MS,
} from "./probeSchedule";

const T0 = 1_000_000_000_000;

describe("a node is not declared dead on one miss", () => {
  it("one miss is unsure, and still counted", () => {
    const r = observe(fresh(), false, T0);
    expect(r.state).toBe("unsure");
    expect(counts(r)).toBe(true);
  });

  it("takes three misses running to be down, and one answer clears them all", () => {
    let r = fresh();
    for (let i = 0; i < MISSES_BEFORE_DOWN - 1; i++) r = observe(r, false, T0 + i);
    expect(r.state).toBe("unsure");
    r = observe(r, false, T0 + 10);
    expect(r.state).toBe("down");
    expect(counts(r)).toBe(false);
    r = observe(r, true, T0 + 20);
    expect(r.state).toBe("alive");
    expect(r.misses).toBe(0);
  });
});

describe("a miss is rechecked sooner and more patiently than the routine pass", () => {
  it("unsure nodes are asked again before the routine interval, with a longer wait", () => {
    const r = observe(fresh(), false, T0);
    const soon = due(r, T0 + INTERVAL_MS.retry);
    expect(soon.ask).toBe(true);
    expect(soon.timeoutMs).toBe(TIMEOUT_MS.retry);
    expect(TIMEOUT_MS.retry).toBeGreaterThan(TIMEOUT_MS.routine);
    expect(INTERVAL_MS.retry).toBeLessThan(INTERVAL_MS.routine);
  });

  it("a node written off is still asked once a day, with the most patience", () => {
    let r = fresh();
    for (let i = 0; i < MISSES_BEFORE_DOWN; i++) r = observe(r, false, T0 + i);
    expect(due(r, T0 + 60 * 60_000).ask).toBe(false); // not every hour
    const daily = due(r, T0 + INTERVAL_MS.recheck + MISSES_BEFORE_DOWN);
    expect(daily.ask).toBe(true);
    expect(daily.timeoutMs).toBe(TIMEOUT_MS.recheck);
  });
});

describe("planning a pass", () => {
  it("splits targets by how patient the probe must be", () => {
    const m = new Map();
    m.set("a", fresh()); // never asked → quick
    m.set("b", observe(fresh(), false, T0 - INTERVAL_MS.retry - 1)); // unsure, due → patient
    m.set("c", observe(fresh(), true, T0 - 1000)); // alive, asked a second ago → not due
    const p = plan(m, ["a", "b", "c"], T0);
    expect(p.quick).toEqual(["a"]);
    expect(p.patient).toEqual(["b"]);
    expect(p.timeoutPatient).toBe(TIMEOUT_MS.retry);
  });
  it("written-off addresses ride in their own slow lane, a few per pass, longest-unasked first", () => {
    const m = new Map();
    const D = 24 * 60 * 60_000;
    for (let i = 0; i < 40; i++) {
      let r = fresh();
      for (let k = 0; k < MISSES_BEFORE_DOWN; k++) r = observe(r, false, T0 - 2 * D - i * 1000);
      m.set(`down${i}`, r);
    }
    m.set("live", observe(fresh(), true, T0 - INTERVAL_MS.routine - 1));
    const p = plan(m, [...m.keys()], T0);
    expect(p.quick).toEqual(["live"]);
    expect(p.patient).toEqual([]);
    expect(p.recheck.length).toBe(RECHECK_PER_PASS);
    expect(p.recheck[0]).toBe("down39"); // asked longest ago
    expect(p.timeoutRecheck).toBe(TIMEOUT_MS.recheck);
    expect(p.timeoutPatient).toBe(TIMEOUT_MS.retry); // no longer stretched to 12 s by the rechecks
  });
});

describe("the name a node announces", () => {
  it("reads the BIP 14 comment and nothing else", () => {
    expect(announcedName("DIVI Core: 3.0.0.0-dd69.2(Geoff's node)")).toBe("Geoff's node");
    expect(announcedName("DIVI Core: 3.0.0.0-dd69.1")).toBe("");
    expect(announcedName("")).toBe("");
    expect(announcedName(undefined)).toBe("");
  });
});

describe("optimism: old evidence is trusted until contradicted", () => {
  const H = 60 * 60_000;
  it("a node that answered two hours ago is assumed alive", () => {
    expect(assumedAlive({ state: "alive", misses: 0, askedAt: T0 - 2 * H, aliveAt: T0 - 2 * H }, T0)).toBe(true);
  });
  it("one that answered three days ago is not", () => {
    expect(assumedAlive({ state: "alive", misses: 0, askedAt: T0 - 72 * H, aliveAt: T0 - 72 * H }, T0)).toBe(false);
  });
  it("one written off is not, however recent", () => {
    expect(assumedAlive({ state: "down", misses: 3, askedAt: T0 - H, aliveAt: T0 - 2 * H }, T0)).toBe(false);
  });
  it("one that has never answered is not", () => {
    expect(assumedAlive(fresh(), T0)).toBe(false);
    expect(assumedAlive(undefined, T0)).toBe(false);
  });
  it("an unsure node that answered today still is (it missed once, not three times)", () => {
    expect(assumedAlive({ state: "unsure", misses: 1, askedAt: T0 - H, aliveAt: T0 - 3 * H }, T0)).toBe(true);
  });
  it("assumed nodes are all due at mount, even ones asked a moment ago", () => {
    const m = new Map([["a", { state: "alive" as const, misses: 0, askedAt: T0 - 5000, aliveAt: T0 - 5000 }]]);
    expect(due(m.get("a"), T0).ask).toBe(false);
    const due0 = markDueNow(m, T0);
    expect(due(due0.get("a"), T0).ask).toBe(true);
    expect(due0.get("a")!.aliveAt).toBe(T0 - 5000);
  });
  it("assumed, then three misses, is down like any other", () => {
    let r = { state: "alive" as const, misses: 0, askedAt: 0, aliveAt: T0 - H } as ReturnType<typeof fresh>;
    for (let i = 0; i < MISSES_BEFORE_DOWN; i++) r = observe(r, false, T0 + i);
    expect(r.state).toBe("down");
    expect(assumedAlive(r, T0 + 10)).toBe(false);
  });
});

describe("the first wave: last session's peers, then the freshest memories", () => {
  const H = 60 * 60_000;
  const rec = (aliveAt: number) => ({ state: "alive" as const, misses: 0, askedAt: aliveAt, aliveAt });
  it("peers come first, in order, once each", () => {
    const m = new Map([["x", rec(T0 - H)], ["p1", rec(T0 - 20 * H)]]);
    expect(firstWave(m, ["p1", "p2", "p1"], T0, 10)).toEqual(["p1", "p2", "x"]);
  });
  it("then the most recently confirmed, up to the limit", () => {
    const m = new Map([["a", rec(T0 - 5 * H)], ["b", rec(T0 - H)], ["c", rec(T0 - 3 * H)], ["old", rec(T0 - 50 * H)]]);
    expect(firstWave(m, [], T0, 2)).toEqual(["b", "c"]);
    expect(firstWave(m, [], T0, 10)).toEqual(["b", "c", "a"]);
  });
  it("a wave splits into parts that can be applied one by one", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
  });
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("probe schedule: all checks passed");
