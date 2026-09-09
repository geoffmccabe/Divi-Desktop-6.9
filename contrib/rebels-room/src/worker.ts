// The front door. It routes and it does nothing else: every decision that
// matters is made inside a Durable Object.

import { RebelsRoom } from "./room";
import { RebelsLedger } from "./ledger";

export { RebelsRoom, RebelsLedger };

interface Env {
  ROOM: DurableObjectNamespace;
  LEDGER: DurableObjectNamespace;
  PAYOUT_SECRET: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    /* /room/<name> — a cockpit joining a world. One object per name, so
       "earth" is one shared fight and a private name is a private one. */
    const room = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,40})(\/[a-z]*)?$/);
    if (room) {
      const id = env.ROOM.idFromName(room[1]);
      return env.ROOM.get(id).fetch(req);
    }

    /* /ledger/* — the payout conversation, and the leaderboard. The object
       checks the secret itself; the router deliberately does not, so there is
       only ONE place that decides who may read a balance. */
    if (url.pathname.startsWith("/ledger/")) {
      /* CREDIT IS NOT A PUBLIC ROUTE, and forwarding it once was a real hole:
         it is the call that adds kills and DIVI to an account, it is trusted
         precisely because only a room can reach it over the binding, and for a
         short while this router happily passed it straight through from the
         internet. Anyone could have minted a balance with one curl.

         It is refused here AND refused again inside the ledger, which checks
         that the request came over the binding rather than off the wire. Two
         checks for one rule is not belt and braces on something cosmetic — the
         thing on the other side of it is a treasury. */
      if (url.pathname === "/ledger/credit") return new Response("not found", { status: 404 });
      /* The player's half of a cash-out is the same kind of thing: a room
         vouches for WHICH account, and only a room can. */
      if (url.pathname === "/ledger/purse" || url.pathname === "/ledger/request") {
        return new Response("not found", { status: 404 });
      }
      const id = env.LEDGER.idFromName("v1");
      return env.LEDGER.get(id).fetch(req);
    }

    if (url.pathname === "/health") return Response.json({ ok: true });
    return new Response("Divi Rebels", { status: 404 });
  },
};
