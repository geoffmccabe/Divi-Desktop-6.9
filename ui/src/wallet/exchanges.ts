// Reads the exchange catalog from the DD69 Supabase project ("Divi-Desktop-6.9").
// This is the list of exchanges the Market Maker feature supports — names,
// endpoints, trading pairs and fees. No secrets live here: the key below is the
// PUBLIC anon key (safe to ship), and row-level security only ever lets it read
// exchanges marked enabled. Adding/editing exchanges happens through a separate,
// privileged admin path — never with this key.

export const SUPABASE_URL = "https://nbnhjstexdlvtwcxopqk.supabase.co";
// Public anon key — intentionally shipped; protected by row-level security.
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibmhqc3RleGRsdnR3Y3hvcHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTQ5MjMsImV4cCI6MjA5OTg3MDkyM30.RxcKVr8mU-XUZCpgfNZvMESRFRomk97AAwPjRIvQZP0";

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
