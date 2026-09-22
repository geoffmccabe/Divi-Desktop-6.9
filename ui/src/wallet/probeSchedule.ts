// Deciding when to ask a node whether it is alive, how patiently, and what
// to conclude from the answer.
//
// THE PROBLEM THIS REPLACES. One probe, one attempt, 2.5 seconds, and a node
// that missed was "offline": drawn grey and dropped from the count until the
// next wave a minute later. A node that is busy, on a slow link, or half a
// world away on a bad day missed constantly, and the count flickered with it.
// Worse, a probe sent from an overloaded machine fails for reasons at OUR
// end, and every such failure was booked against the other node.
//
// THE RULE NOW. Three states, and a node moves between them only on
// evidence:
//   alive   answered the last probe (or is a peer right now)
//   unsure  missed once or twice; still counted, rechecked soon and patiently
//   down    missed three times running; drawn grey, rechecked once a day
// Nothing is declared dead on one miss, a miss is retried sooner and with a
// longer wait than the routine pass, and a node written off is still asked
// again every day so one that comes back reappears on its own.

export type Liveness = "alive" | "unsure" | "down";

export interface ProbeRecord {
  state: Liveness;
  /** Consecutive misses. Reset to 0 on any answer. */
  misses: number;
  /** When we last asked (ms since epoch). 0 = never. */
  askedAt: number;
  /** When it last answered (ms since epoch). 0 = never. */
  aliveAt: number;
}

export const MISSES_BEFORE_DOWN = 3;

/** How long to wait for an answer, by how much doubt there is. */
export const TIMEOUT_MS = {
  routine: 3000, // the regular pass over nodes believed alive
  retry: 8000, // a second look at a node that just missed
  recheck: 12000, // the daily question to a node written off
} as const;

/** How soon each state is asked again. */
export const INTERVAL_MS = {
  routine: 60_000,
  retry: 40_000,
  recheck: 24 * 60 * 60_000,
} as const;

export const fresh = (): ProbeRecord => ({ state: "alive", misses: 0, askedAt: 0, aliveAt: 0 });

/** Is this node due a probe now, and how patient should it be? */
export function due(
  r: ProbeRecord | undefined,
  now: number,
): { ask: boolean; timeoutMs: number } {
  if (!r || r.askedAt === 0) return { ask: true, timeoutMs: TIMEOUT_MS.routine };
  const since = now - r.askedAt;
  switch (r.state) {
    case "alive":
      return { ask: since >= INTERVAL_MS.routine, timeoutMs: TIMEOUT_MS.routine };
    case "unsure":
      return { ask: since >= INTERVAL_MS.retry, timeoutMs: TIMEOUT_MS.retry };
    case "down":
      return { ask: since >= INTERVAL_MS.recheck, timeoutMs: TIMEOUT_MS.recheck };
  }
}

/** Fold one answer into the record. Pure: returns a new record. */
export function observe(r: ProbeRecord | undefined, answered: boolean, now: number): ProbeRecord {
  const base = r ?? fresh();
  if (answered) return { state: "alive", misses: 0, askedAt: now, aliveAt: now };
  const misses = base.misses + 1;
  return {
    state: misses >= MISSES_BEFORE_DOWN ? "down" : "unsure",
    misses,
    askedAt: now,
    aliveAt: base.aliveAt,
  };
}

/** Counted as a node? Alive and unsure yes; down no. */
export const counts = (r: ProbeRecord | undefined): boolean =>
  !r || r.state !== "down";

/**
 * Pick this pass's targets. Returns them grouped by patience, because one
 * probe call has one timeout: a quick routine pass, and a slower one for the
 * nodes that deserve more time.
 */
export function plan(
  records: Map<string, ProbeRecord>,
  candidates: string[],
  now: number,
): { quick: string[]; patient: string[]; timeoutQuick: number; timeoutPatient: number } {
  const quick: string[] = [];
  const patient: string[] = [];
  let timeoutPatient: number = TIMEOUT_MS.retry;
  for (const ip of candidates) {
    const d = due(records.get(ip), now);
    if (!d.ask) continue;
    if (d.timeoutMs <= TIMEOUT_MS.routine) quick.push(ip);
    else {
      patient.push(ip);
      timeoutPatient = Math.max(timeoutPatient, d.timeoutMs);
    }
  }
  return { quick, patient, timeoutQuick: TIMEOUT_MS.routine, timeoutPatient };
}

// ── Persistence, so the daily recheck survives a restart ──────────────────
const KEY = "dd69.probeRecords.v1";

export function loadRecords(): Map<string, ProbeRecord> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, ProbeRecord>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

export function saveRecords(m: Map<string, ProbeRecord>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* storage unavailable */
  }
}

// ── The name a node announces about itself ─────────────────────────────────
/**
 * BIP 14 puts free-text comments in parentheses after the version:
 * "DIVI Core: 3.0.0.0-dd69.2(Geoff's node)". The node owner sets it with
 * -uacomment, which DD69 writes from the name chosen in My Nodes; any other
 * wallet following the same convention shows up the same way. Returns "" when
 * there is no comment, so a nameless node shows nothing rather than "no name".
 */
export function announcedName(subver?: string): string {
  if (!subver) return "";
  const m = /\(([^()]{1,64})\)\s*$/.exec(subver);
  return m ? m[1].trim() : "";
}
