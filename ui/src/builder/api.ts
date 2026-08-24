// Talking to the app builder service (contrib/app-builder).
//
// The service is a separate process, not part of the wallet, and it is not
// running for most people. So every call here is written to fail into a clear
// "not connected" state rather than a spinner that never resolves.
//
// The address is configurable because the service will move: it runs locally
// today and will be hosted once container isolation and the gates exist.

const KEY = "dd69.builderUrl";
const DEFAULT_URL = "http://127.0.0.1:8788";

export function builderUrl(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export function setBuilderUrl(url: string): void {
  try {
    localStorage.setItem(KEY, url.trim().replace(/\/$/, ""));
  } catch {
    // A wallet that cannot remember the address still works; the user re-enters it.
  }
}

export interface Health {
  ok: boolean;
  model: string;
  provider: string;
  rateConfigured: boolean;
  keyConfigured: boolean;
  /** The node's settings were found. It may still be busy or stopped. */
  nodeConfigured: boolean;
  /** A sentence saying why points cannot be bought, or null when they can. */
  buying: string | null;
  sessions: number;
}

export interface BuilderFile {
  path: string;
  bytes: number;
}

export interface Account {
  balancePoints: number;
  spentPoints: number;
  reservedPoints: number;
  turns: number;
  costUsd: number;
  /** Only present if a step somehow outran its hold; see meter.mjs. */
  unbilledPoints?: number;
}

export type TurnEvent =
  | { type: "message"; text: string }
  | { type: "tool"; name: string; path?: string }
  | { type: "usage"; step: number; points: number; usd: number; balancePoints: number }
  | { type: "billing_stopped"; reason: string }
  | { type: "step_limit"; steps: number }
  | { type: "error"; message: string };

export interface TurnResult {
  stopped: "done" | "billing" | "error" | "step_limit";
  reason?: string;
  steps: number;
  events: TurnEvent[];
  files: BuilderFile[];
  account: Account;
  text?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${builderUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `request failed (${res.status})`);
  return body as T;
}

export const health = () => call<Health>("/health");

export const setKey = (key: string) =>
  call<{ keyConfigured: boolean }>("/key", { method: "POST", body: JSON.stringify({ key }) });

// The account is a name, not a balance. An earlier version sent the balance
// from here, which meant anyone could declare themselves rich; the service now
// keeps it and this only says who is asking.
export const createSession = (account: string) =>
  call<{ id: string; account: string; balancePoints: number }>("/session", {
    method: "POST",
    body: JSON.stringify({ account }),
  });

export const sendMessage = (id: string, message: string, model?: string) =>
  call<TurnResult>(`/session/${id}/message`, {
    method: "POST",
    body: JSON.stringify({ message, model }),
  });

export const listFiles = (id: string) => call<{ files: BuilderFile[] }>(`/session/${id}/files`);

export const readFile = (id: string, path: string) =>
  call<{ path: string; text: string }>(`/session/${id}/file?path=${encodeURIComponent(path)}`);

// ---- Admin: screening rules and the log of what they caught ----

export interface ScreenRule {
  id: string;
  weight: number;
  why: string;
  pattern: string;
}

export interface ScreenEntry {
  at: number;
  accountId: string;
  verdict: "allow" | "flag" | "block";
  score: number;
  hits: string[];
  cooling: boolean;
  text: string;
}

export interface Screening {
  thresholds: { flag: number; block: number };
  strikes: { blocksBeforeCooloff: number; cooloffMinutes: number };
  rules: ScreenRule[];
  recent: ScreenEntry[];
}

export interface ReplayResult {
  total: number;
  changed: number;
  changes: Array<{ at: number; was: string; now: string; text: string }>;
}

export const screening = () => call<Screening>("/admin/screening");

export const saveScreening = (body: {
  thresholds?: { flag: number; block: number };
  weights?: Record<string, number>;
}) => call<{ thresholds: { flag: number; block: number } }>("/admin/screening", {
  method: "POST",
  body: JSON.stringify(body),
});

export const replayScreening = () =>
  call<ReplayResult>("/admin/screening/replay", { method: "POST" });
