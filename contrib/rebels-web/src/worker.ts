// Divi Rebels on the web.
//
// Three jobs, and deliberately no more:
//   1. Serve the game's files under /rebels/.
//   2. Hand the page the Divi network as the Scanner has seen it, which the page
//      cannot read directly because the Scanner does not allow other sites to.
//   3. Send anyone at the bare address to /rebels/.
// Everything that matters to the fight (the room, the ledger, cash-out) lives in
// the room Worker, not here.

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

const SCAN_RPC = "https://scan.divi.love/api/rpc";
/** The network changes over hours, not seconds. */
const NODES_SECONDS = 300;

export interface KnownNode {
  ip: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
  lastSeen?: number;
}

/** Only the fields the globe draws, from rows that have them. */
export function cleanNodes(result: unknown): KnownNode[] {
  if (!Array.isArray(result)) return [];
  const out: KnownNode[] = [];
  for (const r of result as Array<Record<string, unknown>>) {
    if (!r || typeof r.ip !== "string" || r.ip.length > 45) continue;
    const lat = Number(r.lat), lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      ip: r.ip, lat, lon,
      ...(typeof r.city === "string" ? { city: r.city.slice(0, 60) } : {}),
      ...(typeof r.country === "string" ? { country: r.country.slice(0, 60) } : {}),
      ...(Number.isFinite(Number(r.lastSeen)) ? { lastSeen: Number(r.lastSeen) } : {}),
    });
    if (out.length >= 400) break;
  }
  return out;
}

async function nodes(req: Request, ctx: Ctx, fetchFn: typeof fetch): Promise<Response> {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(new URL("/rebels/api/nodes", req.url).toString(), { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  let list: KnownNode[] = [];
  try {
    const r = await fetchFn(SCAN_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "scan_known", params: [] }),
    });
    if (r.ok) list = cleanNodes(((await r.json()) as { result?: unknown }).result);
  } catch {
    /* An empty list: the page opens from the Scanner alone. */
  }
  const res = new Response(JSON.stringify(list), {
    headers: {
      "content-type": "application/json",
      /* A failed read is not kept, so the next visitor tries again. */
      "cache-control": list.length ? `public, max-age=${NODES_SECONDS}` : "no-store",
    },
  });
  if (cache && list.length) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/** The headers every page and file gets. */
function withHeaders(res: Response, path: string): Response {
  const h = new Headers(res.headers);
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  /* Build files carry a content hash in their names, so they never change;
     the page itself must always be asked for fresh. */
  if (path.startsWith("/rebels/assets/")) h.set("cache-control", "public, max-age=31536000, immutable");
  else if (path === "/rebels/" || path.endsWith(".html")) h.set("cache-control", "no-cache");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function handle(req: Request, env: Env, ctx: Ctx, fetchFn: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/" || path === "/rebels") return Response.redirect(new URL("/rebels/", url).toString(), 302);
  if (path === "/rebels/api/nodes") {
    if (req.method !== "GET") return new Response("GET only", { status: 405 });
    return nodes(req, ctx, fetchFn);
  }
  if (!path.startsWith("/rebels/")) return new Response("Not found", { status: 404 });
  return withHeaders(await env.ASSETS.fetch(req), path);
}

export default {
  fetch: (req: Request, env: Env, ctx: Ctx) => handle(req, env, ctx),
};
