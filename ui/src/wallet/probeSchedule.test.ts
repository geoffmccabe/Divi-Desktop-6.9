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
  counts,
  due,
  fresh,
  INTERVAL_MS,
  MISSES_BEFORE_DOWN,
  observe,
  plan,
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
});

describe("the name a node announces", () => {
  it("reads the BIP 14 comment and nothing else", () => {
    expect(announcedName("DIVI Core: 3.0.0.0-dd69.2(Geoff's node)")).toBe("Geoff's node");
    expect(announcedName("DIVI Core: 3.0.0.0-dd69.1")).toBe("");
    expect(announcedName("")).toBe("");
    expect(announcedName(undefined)).toBe("");
  });
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("probe schedule: all checks passed");
