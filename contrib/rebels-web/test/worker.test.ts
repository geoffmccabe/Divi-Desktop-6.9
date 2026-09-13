// The web Worker: redirects, the node list, and the files.
//
// Run: sh scripts/run-rebels-web-worker-tests.sh

import { handle, cleanNodes } from "../src/worker";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const served: string[] = [];
const env = {
  ASSETS: {
    fetch: async (req: Request) => {
      served.push(new URL(req.url).pathname);
      return new Response("file", { status: 200, headers: { "content-type": "text/html" } });
    },
  },
};
const ctx = { waitUntil: (_p: Promise<unknown>) => {} };
const at = (p: string, init?: RequestInit) => new Request(`https://divi-rebels-web.example.dev${p}`, init);

{
  const r = await handle(at("/"), env, ctx);
  ok("the bare address goes to /rebels/", r.status === 302 && r.headers.get("location") === "https://divi-rebels-web.example.dev/rebels/");
  const r2 = await handle(at("/rebels"), env, ctx);
  ok("so does /rebels without its slash", r2.status === 302 && (r2.headers.get("location") ?? "").endsWith("/rebels/"));
  const r3 = await handle(at("/wp-admin"), env, ctx);
  ok("anything outside /rebels/ is not found, never another site's page", r3.status === 404);
}

{
  served.length = 0;
  const page = await handle(at("/rebels/"), env, ctx);
  ok("the page is served from the build", page.status === 200 && served[0] === "/rebels/");
  ok("the page is always asked for fresh", page.headers.get("cache-control") === "no-cache");
  ok("with nosniff", page.headers.get("x-content-type-options") === "nosniff");
  const file = await handle(at("/rebels/assets/index-abc123.js"), env, ctx);
  ok("hashed build files are kept for a year", (file.headers.get("cache-control") ?? "").includes("immutable"));
}

{
  let asked: { url: string; body: string } | null = null;
  const scanner = (async (u: string, init?: RequestInit) => {
    asked = { url: u, body: String(init?.body) };
    return new Response(JSON.stringify({ result: [
      { ip: "64.188.28.182", lat: 34.05, lon: -118.24, city: "Los Angeles", country: "United States", lastSeen: 5 },
      { ip: "bad", lat: "north", lon: 1 },
    ] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await handle(at("/rebels/api/nodes"), env, ctx, scanner);
  const list = await r.json() as Array<{ ip: string }>;
  ok("the node list is read from the Scanner's scan_known",
     asked !== null && (asked as { url: string }).url === "https://scan.divi.love/api/rpc" && (asked as { body: string }).body.includes("scan_known"));
  ok("and handed over with only the rows that have a position", list.length === 1 && list[0].ip === "64.188.28.182", JSON.stringify(list));
  ok("kept for five minutes", r.headers.get("cache-control") === "public, max-age=300");

  const down = await handle(at("/rebels/api/nodes"), env, ctx, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
  ok("with the Scanner down the page gets an empty list, not an error", down.status === 200 && (await down.json() as unknown[]).length === 0);
  ok("and that empty answer is not kept", down.headers.get("cache-control") === "no-store");
  const post = await handle(at("/rebels/api/nodes", { method: "POST", body: "{}" }), env, ctx);
  ok("the node list only answers GET", post.status === 405);
}

{
  const long = cleanNodes(Array.from({ length: 900 }, (_, i) => ({ ip: `10.0.${i >> 8}.${i & 255}`, lat: 1, lon: 1 })));
  ok("never more than 400 nodes", long.length === 400);
  ok("anything that is not a list is nothing", cleanNodes({ result: 1 }).length === 0);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
