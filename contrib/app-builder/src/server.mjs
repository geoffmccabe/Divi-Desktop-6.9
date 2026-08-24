// The builder service.
//
// Small on purpose: create a session, send it messages, read back the files the
// model wrote, buy the points that pay for it all.
//
// Zero dependencies. Node's own http server and fetch are enough, and every
// package not added is one that cannot go bad later.
//
// NOT YET WIRED, and deliberately so:
//   * Proving who an account belongs to. An account name is taken at its word,
//     which is fine while this listens on the loopback address only. Signing a
//     challenge with a Divi address is the next piece, and until it lands this
//     must not be exposed to a network.
//   * Container isolation. The workspace is path-safe but shares the host.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Workspace } from "./workspace.mjs";
import { SessionMeter } from "./meter.mjs";
import { makeProvider } from "./provider.mjs";
import { runTurn } from "./agent.mjs";
import { Scanner, VERDICT } from "./scanner.mjs";
import { checkApp, summarise } from "./gate.mjs";
import { Accounts } from "./accounts.mjs";
import { Orders } from "./orders.mjs";
import { priceCatalogue, POINTS_PER_USD, MARKUP } from "./points.mjs";
import { readRpcConfig, nodeClient, defaultDatadir } from "./chain.mjs";

const SESSIONS = new Map();

// One scanner for the process, so the log and the strike counts are shared
// across sessions. Someone who gets blocked, opens a new session and tries again
// should still be the same person as far as this is concerned.
const SCANNER = new Scanner();

/**
 * Where a request may come from.
 *
 * Two jobs, one list. A browser will not let the wallet read a reply from
 * another origin unless that origin is named back, so without this the panel
 * simply says "load failed". And naming them is also what stops a random web
 * page you happen to have open from quietly driving this service: an unknown
 * origin is refused outright rather than served.
 *
 * Tauri serves the wallet from these. A tool with no origin at all (curl, a
 * test) is allowed, because that is a person on this machine, which is the same
 * trust level as the service itself.
 */
export const WALLET_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

export function allowedOrigins(env = process.env) {
  const extra = String(env.BUILDER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...WALLET_ORIGINS, ...extra];
}

export function loadConfig(env = process.env) {
  const root = env.BUILDER_ROOT ?? path.join(os.tmpdir(), "dd69-builder");
  return {
    origins: allowedOrigins(env),
    port: Number(env.PORT ?? 8788),
    // Bound to loopback until accounts can be proved. Changing this is a
    // deliberate act with real consequences.
    host: env.HOST ?? "127.0.0.1",
    root,
    model: env.BUILDER_MODEL ?? "claude-sonnet-5",
    provider: {
      kind: env.BUILDER_PROVIDER ?? "anthropic",
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.BUILDER_BASE_URL,
    },
    // An admin-set number, never a live feed: DIVI price aggregators disagree by
    // roughly 4.5x, so a feed here would be indefensible.
    diviPerUsd: Number(env.DIVI_PER_USD ?? 0),
    /** Where buyers send their DIVI. Points are only ever credited from here. */
    treasuryAddress: env.DIVI_TREASURY_ADDRESS ?? null,
    /** The points ledger. Append-only, and the only place a balance exists. */
    ledgerFile: env.BUILDER_LEDGER ?? path.join(root, "points-ledger.jsonl"),
    datadir: env.DIVI_DATADIR ?? defaultDatadir(),
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > limitBytes) throw new Error("request body is too large");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createServer(config = loadConfig()) {
  const accounts = new Accounts({ file: config.ledgerFile });

  // Set up in the background; every request waits for it. Doing this lazily
  // keeps createServer synchronous for callers and tests.
  const ready = (async () => {
    await accounts.load();
    const rpc = await readRpcConfig(config.datadir);
    const node = rpc ? nodeClient(rpc) : null;
    const orders = new Orders({
      accounts,
      treasuryAddress: config.treasuryAddress,
      diviPerUsd: config.diviPerUsd,
      node,
    });
    return { orders, node };
  })();

  const origins = config.origins ?? WALLET_ORIGINS;

  const server = http.createServer(async (req, res) => {
    try {
      // A request carrying an origin we do not know is refused before it can do
      // anything. This is what keeps a web page you have open in a browser from
      // creating sessions, spending on the model, or turning off screening —
      // all of which it could otherwise do, because a browser will happily send
      // a request to this machine even though it cannot read the reply.
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin)) {
        return json(res, 403, { error: "requests from this origin are not accepted" });
      }
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "origin");
        res.setHeader("access-control-allow-headers", "content-type");
        res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(origin ? 204 : 403);
        return res.end();
      }

      const { orders, node } = await ready;
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          model: config.model,
          provider: config.provider.kind,
          // Surfaced because a builder that cannot bill must not take work.
          rateConfigured: config.diviPerUsd > 0,
          // So the panel can say exactly what is missing rather than just
          // failing when the first message is sent.
          keyConfigured: Boolean(config.provider.apiKey),
          // Whether the node's settings were FOUND, which is not the same as
          // the node answering: it may be reindexing or stopped. A payment
          // check that cannot reach it leaves the order open and says so, so
          // claiming more than this here would be a lie with consequences.
          nodeConfigured: Boolean(node),
          buying: orders.unavailable() ?? null,
          sessions: SESSIONS.size,
        });
      }

      // ---- Points: what a bundle costs, what an account holds, buying ----

      if (req.method === "GET" && url.pathname === "/points/catalogue") {
        const why = orders.unavailable();
        return json(res, 200, {
          available: !why,
          why,
          pointsPerUsd: POINTS_PER_USD,
          markup: MARKUP,
          diviPerUsd: config.diviPerUsd,
          treasuryAddress: config.treasuryAddress,
          tiers: config.diviPerUsd > 0 ? priceCatalogue(config.diviPerUsd) : [],
        });
      }

      if (req.method === "GET" && url.pathname === "/points/account") {
        const account = url.searchParams.get("account") ?? "";
        return json(res, 200, {
          account,
          balancePoints: accounts.balance(account),
          history: accounts.history(account, 50),
        });
      }

      if (req.method === "POST" && url.pathname === "/points/order") {
        const body = await readJson(req);
        return json(res, 201, orders.create({ account: body.account, tierId: body.tierId }));
      }

      if (parts[0] === "points" && parts[1] === "order" && parts[2]) {
        if (req.method === "GET" && parts.length === 3) {
          return json(res, 200, orders.publicView(orders.get(parts[2])));
        }
        if (req.method === "POST" && parts[3] === "claim") {
          const body = await readJson(req);
          return json(res, 200, await orders.claim(parts[2], body.txid));
        }
      }

      // The model credential, handed over by the wallet panel.
      //
      // It arrives only when a person pastes it, and is held in memory for the
      // life of this process: never written to disk, never logged, and sent
      // nowhere except the model provider.
      //
      // An earlier version obtained it from the operating system's secure store
      // instead. That was rejected on purpose. A background service that reads
      // secrets belonging to other applications looks exactly like something
      // hostile, whatever it intends, and this project's own checks flag that
      // shape. Having a person paste it is both clearer and easier to audit.
      if (req.method === "POST" && url.pathname === "/key") {
        const body = await readJson(req);
        const key = String(body.key ?? "").trim();
        if (key.length < 20) return json(res, 400, { error: "that does not look like a key" });
        config.provider.apiKey = key;
        return json(res, 200, { keyConfigured: true });
      }

      if (req.method === "POST" && url.pathname === "/session") {
        if (!(config.diviPerUsd > 0)) {
          return json(res, 503, { error: "the DIVI rate has not been set, so nothing can be billed" });
        }
        const body = await readJson(req);
        // The account is a name; the BALANCE is ours. An earlier version took
        // the balance from this request, which meant anyone could declare
        // themselves rich. It now comes from the ledger and nowhere else.
        const account = String(body.account ?? "local").trim() || "local";
        const id = randomUUID();
        const workspace = new Workspace(path.join(config.root, id));
        await workspace.init();
        SESSIONS.set(id, {
          id,
          workspace,
          account,
          meter: new SessionMeter({ accounts, account }),
          history: [],
          createdAt: Date.now(),
        });
        return json(res, 201, { id, account, balancePoints: accounts.balance(account) });
      }

      const session = parts[0] === "session" && parts[1] ? SESSIONS.get(parts[1]) : null;
      if (parts[0] === "session" && !session) return json(res, 404, { error: "no such session" });

      if (req.method === "POST" && parts[2] === "message") {
        const body = await readJson(req);
        const message = String(body.message ?? "").slice(0, 8000);
        if (!message.trim()) return json(res, 400, { error: "a message is required" });

        // Screened BEFORE the model is called, so a blocked request costs
        // nothing. This is not the security boundary (the tools are), but there
        // is no reason to pay for an obvious attempt.
        const screen = SCANNER.scan(message, { accountId: session.account });
        if (screen.verdict === VERDICT.BLOCK) {
          return json(res, 200, {
            stopped: "refused",
            reason: screen.message,
            steps: 0,
            events: [{ type: "error", message: screen.message }],
            files: await session.workspace.list(),
            account: session.meter.summary(),
          });
        }

        const events = [];
        const result = await runTurn({
          provider: makeProvider(config.provider),
          workspace: session.workspace,
          meter: session.meter,
          history: session.history,
          message,
          model: body.model ?? config.model,
          onEvent: (e) => events.push(e),
        });

        return json(res, 200, {
          ...result,
          events,
          files: await session.workspace.list(),
          account: session.meter.summary(),
        });
      }

      // Run the code checks over whatever has been written so far. Safe to call
      // as often as you like: it reads files and spends nothing.
      if (req.method === "GET" && parts[2] === "check") {
        const list = await session.workspace.list();
        const files = [];
        for (const f of list) {
          // Only source is worth reading into memory for this.
          if (/\.(html|js|css|json|svg|md|txt)$/i.test(f.path)) {
            files.push({ path: f.path, text: (await session.workspace.read(f.path)).text });
          } else {
            files.push({ path: f.path });
          }
        }
        let manifest;
        try {
          manifest = JSON.parse(files.find((f) => f.path === "manifest.json")?.text ?? "null");
        } catch {
          manifest = null;
        }
        const result = checkApp({ files, manifest });
        return json(res, 200, { ...result, summary: summarise(result) });
      }

      // Admin: the screening log, and what a rule change would have done to it.
      if (req.method === "GET" && url.pathname === "/admin/screening") {
        return json(res, 200, {
          thresholds: SCANNER.thresholds,
          strikes: SCANNER.strikes,
          rules: SCANNER.rules.map((r) => ({ id: r.id, weight: r.weight, why: r.why, pattern: String(r.re) })),
          recent: SCANNER.recent(200),
        });
      }

      if (req.method === "POST" && url.pathname === "/admin/screening") {
        const body = await readJson(req);
        if (body.thresholds) {
          const flag = Number(body.thresholds.flag);
          const block = Number(body.thresholds.block);
          if (!(flag >= 0 && block > flag)) {
            return json(res, 400, { error: "the block level must be above the flag level" });
          }
          SCANNER.thresholds = { flag, block };
        }
        if (body.weights && typeof body.weights === "object") {
          for (const rule of SCANNER.rules) {
            const w = Number(body.weights[rule.id]);
            if (Number.isFinite(w) && w >= 0 && w <= 200) rule.weight = w;
          }
        }
        return json(res, 200, { thresholds: SCANNER.thresholds });
      }

      if (req.method === "POST" && url.pathname === "/admin/screening/replay") {
        return json(res, 200, SCANNER.replay());
      }

      // Admin: the whole points ledger, for reconciling against a provider bill.
      if (req.method === "GET" && url.pathname === "/admin/ledger") {
        return json(res, 200, { lines: accounts.all().slice(-500).reverse() });
      }

      if (req.method === "GET" && parts[2] === "files") {
        return json(res, 200, { files: await session.workspace.list() });
      }

      if (req.method === "GET" && parts[2] === "file") {
        const wanted = url.searchParams.get("path") ?? "";
        return json(res, 200, await session.workspace.read(wanted));
      }

      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 400, { error: e?.message ?? "request failed" });
    }
  });

  server.on("listening", () => {
    const timer = setInterval(() => ready.then(({ orders }) => orders.sweep()).catch(() => {}), 10 * 60_000);
    timer.unref?.();
    server.once("close", () => clearInterval(timer));
  });

  return server;
}

// Only starts when run directly, so tests can import the server without one
// binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  createServer(config).listen(config.port, config.host, () => {
    console.log(`builder on http://${config.host}:${config.port}`);
    if (!(config.diviPerUsd > 0)) {
      console.log("DIVI_PER_USD is not set, so sessions will be refused until it is.");
    }
    if (!config.treasuryAddress) {
      console.log("DIVI_TREASURY_ADDRESS is not set, so points cannot be bought until it is.");
    }
  });
}
