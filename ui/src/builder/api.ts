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
  sessions: number;
}

export interface BuilderFile {
  path: string;
  bytes: number;
}

export interface Account {
  balanceDivi: number;
  spentDivi: number;
  reservedDivi: number;
  turns: number;
  costUsd: number;
}

export type TurnEvent =
  | { type: "message"; text: string }
  | { type: "tool"; name: string; path?: string }
  | { type: "usage"; step: number; divi: number; usd: number; balanceDivi: number }
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

export const createSession = (balanceDivi: number) =>
  call<{ id: string }>("/session", {
    method: "POST",
    body: JSON.stringify({ balanceDivi }),
  });

export const sendMessage = (id: string, message: string, model?: string) =>
  call<TurnResult>(`/session/${id}/message`, {
    method: "POST",
    body: JSON.stringify({ message, model }),
  });

export const listFiles = (id: string) => call<{ files: BuilderFile[] }>(`/session/${id}/files`);

export const readFile = (id: string, path: string) =>
  call<{ path: string; text: string }>(`/session/${id}/file?path=${encodeURIComponent(path)}`);
