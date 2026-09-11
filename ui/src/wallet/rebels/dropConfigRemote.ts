// The live drop charts: read by every cockpit and by the room, written by
// the admin panel. One row in the DD69 Supabase project (rebels_drops, id
// 'live'). Falls back to the default in dropCharts.ts when the table cannot
// be reached or holds something the validator refuses, so a bad save can
// never stop items dropping altogether.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../exchanges";
import { DEFAULT_DROP_CONFIG, validateDropConfig, type DropConfig } from "./dropCharts";

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

/** The live config, or the default. Never throws. */
export async function fetchDropConfig(fetchFn: typeof fetch = fetch): Promise<{ config: DropConfig; live: boolean; error?: string }> {
  try {
    const res = await fetchFn(`${SUPABASE_URL}/rest/v1/rebels_drops?id=eq.live&select=config`, { headers });
    if (!res.ok) return { config: DEFAULT_DROP_CONFIG, live: false, error: `http ${res.status}` };
    const rows = (await res.json()) as Array<{ config?: unknown }>;
    if (!rows.length) return { config: DEFAULT_DROP_CONFIG, live: false, error: "no live row yet" };
    const v = validateDropConfig(rows[0].config);
    if ("errors" in v) return { config: DEFAULT_DROP_CONFIG, live: false, error: v.errors.join("; ") };
    return { config: v.ok, live: true };
  } catch (e) {
    return { config: DEFAULT_DROP_CONFIG, live: false, error: String((e as Error)?.message ?? e) };
  }
}

/** Save with the admin secret. The error text is the server's, when it refuses. */
export async function saveDropConfig(secret: string, config: DropConfig, fetchFn: typeof fetch = fetch): Promise<{ ok: true } | { error: string }> {
  const v = validateDropConfig(config);
  if ("errors" in v) return { error: v.errors.join("; ") };
  try {
    const res = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/rebels_drops_save`, {
      method: "POST", headers, body: JSON.stringify({ p_secret: secret, p_config: v.ok }),
    });
    if (res.ok) return { ok: true };
    let why = `http ${res.status}`;
    try { const j = (await res.json()) as { message?: string }; if (j.message) why = j.message; } catch { /* plain */ }
    return { error: why };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}
