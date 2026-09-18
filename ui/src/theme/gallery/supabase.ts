// The Divi-Desktop-6.9 Supabase project (skins marketplace only, so far).
// This key is a public/publishable client key, not a secret — the real
// security boundary is the Row Level Security policy on each table/bucket
// (see supabase/migrations/2026071716*_skins*.sql), the same way any
// Supabase-backed client app embeds its anon key.
export const SUPABASE_URL = "https://nbnhjstexdlvtwcxopqk.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibmhqc3RleGRsdnR3Y3hvcHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTQ5MjMsImV4cCI6MjA5OTg3MDkyM30.RxcKVr8mU-XUZCpgfNZvMESRFRomk97AAwPjRIvQZP0";

export function supabaseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}
