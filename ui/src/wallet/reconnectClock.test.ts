// Plain script: sh scripts/run-probe-tests.sh runs this too.
import { ReconnectClock } from "./reconnectClock";
let failed = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`); };

const T0 = 1_000_000;
{
  const c = new ReconnectClock(T0, ["a", "b", "c", "d"]);
  ok("nothing yet: not done", !c.report(T0).done);
  c.peerSeen(T0 + 800);
  c.confirm("a", T0 + 1000); c.confirm("b", T0 + 1200);
  ok("half at the second confirmation", c.report(T0 + 1300).line.includes("+1.2s 50% confirmed (2 of 4)"), c.report(T0 + 1300).line);
  c.confirm("zzz", T0 + 1300); // not expected: ignored
  c.confirm("c", T0 + 4100); c.confirm("c", T0 + 9000); // twice: once
  ok("90% needs 4 of 4 here, so not yet", !c.report(T0 + 4200).line.includes("90%"));
  c.confirm("d", T0 + 4500);
  const r = c.report(T0 + 4600);
  ok("90% reached and done", r.done && r.line.includes("+4.5s 90%"), r.line);
  ok("reported exactly once", c.shouldReport(T0 + 4600) && !c.shouldReport(T0 + 4700));
  ok("the line starts with the memory count", r.line.startsWith("map: reconnect +0.0s drawn 4 from memory, +0.8s first peer"), r.line);
}
{
  const c = new ReconnectClock(T0, []);
  ok("nothing remembered: done only when the wave finishes", !c.report(T0).done);
  c.waveDone(T0 + 6000);
  ok("wave done closes it", c.report(T0 + 6000).done && c.report(T0 + 6000).line.includes("+6.0s wave done, 0 of 0 confirmed"));
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("reconnect clock: all checks passed");
