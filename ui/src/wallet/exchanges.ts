// Reads the exchange catalog from the DD69 Supabase project ("Divi-Desktop-6.9").
// This is the list of exchanges the Market Maker feature supports — names,
// endpoints, trading pairs and fees. No secrets live here: the key it uses is the
// PUBLIC anon key (safe to ship), and row-level security only ever lets it read
// exchanges marked enabled. Adding/editing exchanges happens through a separate,
// privileged admin path — never with this key.

// The project's address and public anon key live in ../supabaseProject.ts, shared
// with Divi Rebels. Re-exported so every existing import keeps working.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabaseProject";
export { SUPABASE_URL, SUPABASE_ANON_KEY };

export interface Exchange {
  id: string;
  name: string;
  slug: string;
  connector_type: string;
  rest_url: string | null;
  ws_url: string | null;
  pairs: string[];
  maker_fee_pct: number | null;
  taker_fee_pct: number | null;
  enabled: boolean;
  sort_order: number;
}

// Fetch the enabled exchanges, ordered for display. Throws on a network/HTTP
// error so callers can decide how to degrade (the previews just hide the list).
export async function fetchExchanges(): Promise<Exchange[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/exchanges?enabled=eq.true&order=sort_order.asc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`exchanges fetch failed: ${res.status}`);
  return (await res.json()) as Exchange[];
}
