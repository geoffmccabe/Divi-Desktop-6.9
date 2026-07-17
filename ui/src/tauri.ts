// One place that talks to the Rust backend. Everything else imports invoke()
// from here so there's a single, typed boundary.
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core: { invoke: Invoke } };
  }
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const inv = window.__TAURI__?.core?.invoke;
  if (!inv) return Promise.reject(new Error("Not running inside the desktop app"));
  return inv<T>(cmd, args);
}

export const inApp = () => Boolean(window.__TAURI__?.core?.invoke);
