// The reconnect stopwatch: how long the map takes to come back to life,
// written into the setup log so Geoff's own machine reports it.
//
// Pure. The map feeds it moments; it produces one line like
//   map: reconnect +0.0s drawn 113 from memory, +0.8s first peer,
//        +1.2s 50% confirmed (57 of 113), +4.1s 90%, +6.0s wave done
// "Expected" is how many nodes memory drew as alive at mount; confirmations
// are probe answers (or live peers) for those same nodes.

export interface ReconnectReport {
  line: string;
  done: boolean;
}

export class ReconnectClock {
  private readonly t0: number;
  private readonly expected: Set<string>;
  private readonly confirmed = new Set<string>();
  private firstPeerAt = -1;
  private halfAt = -1;
  private ninetyAt = -1;
  private waveDoneAt = -1;
  private reported = false;

  constructor(now: number, expectedIps: Iterable<string>) {
    this.t0 = now;
    this.expected = new Set(expectedIps);
  }

  peerSeen(now: number): void {
    if (this.firstPeerAt < 0) this.firstPeerAt = now;
  }

  /** A node from the expected set answered (probe or live peer). */
  confirm(ip: string, now: number): void {
    if (!this.expected.has(ip) || this.confirmed.has(ip)) return;
    this.confirmed.add(ip);
    const n = this.expected.size;
    if (this.halfAt < 0 && this.confirmed.size >= Math.ceil(n * 0.5)) this.halfAt = now;
    if (this.ninetyAt < 0 && this.confirmed.size >= Math.ceil(n * 0.9)) this.ninetyAt = now;
  }

  waveDone(now: number): void {
    if (this.waveDoneAt < 0) this.waveDoneAt = now;
  }

  /** The line, and whether there is nothing more to wait for. Reported
   *  once: the first time it is complete, or on demand. */
  report(now: number): ReconnectReport {
    const s = (t: number) => `+${((t - this.t0) / 1000).toFixed(1)}s`;
    const n = this.expected.size;
    const parts = [`${s(this.t0)} drawn ${n} from memory`];
    if (this.firstPeerAt >= 0) parts.push(`${s(this.firstPeerAt)} first peer`);
    if (this.halfAt >= 0) parts.push(`${s(this.halfAt)} 50% confirmed (${Math.ceil(n * 0.5)} of ${n})`);
    if (this.ninetyAt >= 0) parts.push(`${s(this.ninetyAt)} 90%`);
    if (this.waveDoneAt >= 0) parts.push(`${s(this.waveDoneAt)} wave done, ${this.confirmed.size} of ${n} confirmed`);
    const done = this.waveDoneAt >= 0 || (n > 0 && this.ninetyAt >= 0);
    void now;
    return { line: `map: reconnect ${parts.join(", ")}`, done };
  }

  /** True once, when the report should be written. */
  shouldReport(now: number): boolean {
    if (this.reported) return false;
    const r = this.report(now);
    if (!r.done) return false;
    this.reported = true;
    return true;
  }
}
