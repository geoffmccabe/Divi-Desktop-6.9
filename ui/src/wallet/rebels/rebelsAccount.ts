// The game's one way to the account database.
//
// Scores, loadout, ships, forging and the drop charts all live in the Divi
// Desktop Supabase project. Each of their files used to build its own address and
// headers; now they all come through here, and the CONNECTION (the address, the
// public key, and later a signed-in player's credential) comes from the door
// (platform().account). So sign-in on the web, or Lovenode's own identity, changes
// one place rather than five.
//
// The requests are exactly what they were: rebelsAccount.test.ts compares every
// one with a recording made before this file existed.

import { platform } from "./platform/current";

function headers(): Record<string, string> {
  const c = platform().account;
  /* A signed-in door hands over the player's own credential; until then the
     public key is the credential, exactly as before. */
  const bearer = c.bearer?.() || c.anonKey;
  return {
    apikey: c.anonKey,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  };
}

/** Read rows: `pathAndQuery` is the table and its query, e.g.
 *  "rebels_scores?select=name&limit=10". */
export function accountRead(pathAndQuery: string, fetchFn: typeof fetch = fetch): Promise<Response> {
  return fetchFn(`${platform().account.url}/rest/v1/${pathAndQuery}`, { headers: headers() });
}

/** Call a database function with its named arguments. */
export function accountCall(fn: string, args: Record<string, unknown>, fetchFn: typeof fetch = fetch): Promise<Response> {
  return fetchFn(`${platform().account.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
  });
}
