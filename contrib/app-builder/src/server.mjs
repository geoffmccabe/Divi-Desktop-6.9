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
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Projects, defaultRoot } from "./projects.mjs";
import { SessionMeter } from "./meter.mjs";
import { makeProvider } from "./provider.mjs";
import { runTurn } from "./agent.mjs";
import { Scanner, VERDICT } from "./scanner.mjs";
import { checkApp, summarise } from "./gate.mjs";
import { readSdk } from "./scaffold.mjs";
import { Accounts } from "./accounts.mjs";
import { Orders } from "./orders.mjs";
import { priceCatalogue, POINTS_PER_USD, MARKUP } from "./points.mjs";
import { readRpcConfig, nodeClient, proxyClient, defaultDatadir } from "./chain.mjs";
import { DiviPrice } from "./price.mjs";

// A meter per open project, so the per-session ceilings mean something across
// several messages. Rebuilt from the ledger on restart, because the balance it
// works from lives there rather than here.
const METERS = new Map();

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

/**
 * The address points are paid into: a child address of the London node,
 * labelled `dd69-points` there, so incoming purchases can be tracked on that
 * one address alone.
 */
export const DEFAULT_TREASURY = "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt";

export function loadConfig(env = process.env) {
  // Never the temp directory: the operating system clears it, and somebody who
  // spent points building an app would simply lose it.
  const root = env.BUILDER_ROOT ?? defaultRoot();
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
    /**
     * The DIVI price comes from CoinMarketCap and nowhere else. Standing order,
     * and there is a number behind it: CoinGecko prices DIVI off a thinly
     * traded wrapped token and reads about 4.5x lower, which would sell four
     * times the build time for the same money. See price.mjs.
     */
    cmcApiKey: env.CMC_API_KEY ?? null,
    /**
     * Where buyers send their DIVI: a child address of the node we run in
     * London, so every payment for points is visible on that one address.
     */
    treasuryAddress: env.DIVI_TREASURY_ADDRESS ?? DEFAULT_TREASURY,
    /**
     * The chain lookup used to confirm payments. Left unset, the wallet's own
     * node answers, which works because it indexes addresses. Pointed at the
     * London node's read-only proxy, that node answers instead — which is the
     * better arrangement, since it is the one that actually holds the address.
     */
    chainProxyUrl: env.DIVI_CHAIN_PROXY_URL ?? null,
    chainProxySecret: env.DIVI_CHAIN_PROXY_SECRET ?? null,
    /** The points ledger. Append-only, and the only place a balance exists. */
    ledgerFile: env.BUILDER_LEDGER ?? path.join(root, "points-ledger.jsonl"),
    /**
     * Points handed to an account the first time it is seen, once ever.
     *
     * Off unless set. It exists so a tester can try the thing without buying
     * first; it is recorded in the ledger like any other movement, so free
     * points are never invisible when the books are read.
     */
    welcomePoints: Number(env.BUILDER_WELCOME_POINTS ?? 0),
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
  const price = new DiviPrice({ apiKey: config.cmcApiKey });
  const projects = new Projects({ root: config.root });

  /** Hand a new account its opening credit, once and only once. */
  const welcome = async (account) => {
    if (!(config.welcomePoints > 0)) return;
    const seen = accounts.history(account, 1).length > 0;
    if (seen) return;
    await accounts.credit(account, config.welcomePoints, {
      reason: "opening credit",
      note: "granted once, the first time this account was seen",
    }, "adjust");
  };

  const meterFor = (project) => {
    let m = METERS.get(project.id);
    if (!m) {
      m = new SessionMeter({ accounts, account: project.account });
      METERS.set(project.id, m);
    }
    return m;
  };

  const ready = (async () => {
    await accounts.load();
    await projects.load();
    // Prefer the node that actually holds the purchase address; fall back to
    // the wallet's own node, which can answer because it indexes addresses too.
    let node = null;
    if (config.chainProxyUrl) {
      node = proxyClient({ url: config.chainProxyUrl, secret: config.chainProxySecret });
    } else {
      const rpc = await readRpcConfig(config.datadir);
      node = rpc ? nodeClient(rpc) : null;
    }
    const orders = new Orders({
      accounts,
      treasuryAddress: config.treasuryAddress,
      price,
      node,
    });
    return { orders, node, projects };
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
          rateConfigured: price.configured,
          price: price.status(),
          // So the panel can say exactly what is missing rather than just
          // failing when the first message is sent.
          keyConfigured: Boolean(config.provider.apiKey),
          // Whether the node's settings were FOUND, which is not the same as
          // the node answering: it may be reindexing or stopped. A payment
          // check that cannot reach it leaves the order open and says so, so
          // claiming more than this here would be a lie with consequences.
          nodeConfigured: Boolean(node),
          buying: orders.unavailable() ?? null,
          projects: projects.byId.size,
        });
      }

      // ---- Points: what a bundle costs, what an account holds, buying ----

      if (req.method === "GET" && url.pathname === "/points/catalogue") {
        let why = orders.unavailable();
        let tiers = [];
        let diviPerUsd = null;
        if (!why) {
          try {
            diviPerUsd = await price.diviPerUsd();
            tiers = priceCatalogue(diviPerUsd);
          } catch (e) {
            // No price means no selling. It never falls back to another source:
            // the alternative reads about 4.5x low and would give away four
            // times the build time for the same money.
            why = `DIVI cannot be priced right now: ${e.message}`;
          }
        }
        return json(res, 200, {
          available: !why,
          why,
          pointsPerUsd: POINTS_PER_USD,
          markup: MARKUP,
          diviPerUsd,
          priceSource: "coinmarketcap",
          treasuryAddress: config.treasuryAddress,
          tiers,
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
        return json(res, 201, await orders.create({ account: body.account, tierId: body.tierId }));
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
      // The CoinMarketCap key, handed over by the wallet's Value panel the same
      // way the model key is: in memory only, never written down, and used for
      // nothing but pricing DIVI.
      if (req.method === "POST" && url.pathname === "/cmc-key") {
        const body = await readJson(req);
        const key = String(body.key ?? "").trim();
        if (key.length < 16) return json(res, 400, { error: "that does not look like a key" });
        price.setKey(key);
        return json(res, 200, price.status());
      }

      if (req.method === "POST" && url.pathname === "/key") {
        const body = await readJson(req);
        const key = String(body.key ?? "").trim();
        if (key.length < 20) return json(res, 400, { error: "that does not look like a key" });
        config.provider.apiKey = key;
        return json(res, 200, { keyConfigured: true });
      }

      // ---- Projects: create, list, continue, rename, delete ----

      if (req.method === "POST" && url.pathname === "/project") {
        if (!price.configured) {
          return json(res, 503, {
            error: "DIVI cannot be priced without a CoinMarketCap key, so nothing can be billed",
          });
        }
        const body = await readJson(req);
        // The account is a name; the BALANCE is ours. An earlier version took
        // the balance from this request, which meant anyone could declare
        // themselves rich. It now comes from the ledger and nowhere else.
        const account = String(body.account ?? "local").trim() || "local";
        await welcome(account);
        const project = await projects.create({ account, name: body.name });
        return json(res, 201, {
          ...project.summary(),
          balancePoints: accounts.balance(account),
        });
      }

      if (req.method === "GET" && url.pathname === "/projects") {
        const account = url.searchParams.get("account") ?? "";
        await welcome(account);
        return json(res, 200, {
          projects: projects.list(account),
          balancePoints: accounts.balance(account),
        });
      }

      const project =
        parts[0] === "project" && parts[1] ? projects.byId.get(parts[1]) ?? null : null;
      if (parts[0] === "project" && parts[1] && !project) {
        return json(res, 404, { error: "no such project" });
      }

      if (project && req.method === "GET" && parts.length === 2) {
        return json(res, 200, {
          ...project.summary(),
          files: await project.workspace.list(),
          // The conversation comes back too, so opening a project shows what
          // was said rather than an empty box above a half-built app.
          history: project.history,
          balancePoints: accounts.balance(project.account),
        });
      }

      if (project && req.method === "POST" && parts[2] === "rename") {
        const body = await readJson(req);
        return json(res, 200, await projects.rename(project.id, body.name));
      }

      if (project && req.method === "DELETE" && parts.length === 2) {
        METERS.delete(project.id);
        return json(res, 200, await projects.remove(project.id));
      }

      if (project && req.method === "POST" && parts[2] === "message") {
        const body = await readJson(req);
        const message = String(body.message ?? "").slice(0, 8000);
        if (!message.trim()) return json(res, 400, { error: "a message is required" });

        // Screened BEFORE the model is called, so a blocked request costs
        // nothing. This is not the security boundary (the tools are), but there
        // is no reason to pay for an obvious attempt.
        const screen = SCANNER.scan(message, { accountId: project.account });
        if (screen.verdict === VERDICT.BLOCK) {
          return json(res, 200, {
            stopped: "refused",
            reason: screen.message,
            steps: 0,
            events: [{ type: "error", message: screen.message }],
            files: await project.workspace.list(),
            account: meterFor(project).summary(),
          });
        }

        const meter = meterFor(project);
        const events = [];
        const result = await runTurn({
          provider: makeProvider(config.provider),
          workspace: project.workspace,
          meter,
          history: project.history,
          message,
          model: body.model ?? config.model,
          onEvent: (e) => events.push(e),
        });

        // Saved after every message, not at the end of anything: an interrupted
        // build keeps the work and the conversation it came from.
        project.meta.pointsSpent = (project.meta.pointsSpent ?? 0) + meterSpent(result);
        await project.save();

        return json(res, 200, {
          ...result,
          events,
          files: await project.workspace.list(),
          account: meter.summary(),
        });
      }

      // Run the code checks over whatever has been written so far. Safe to call
      // as often as you like: it reads files and spends nothing.
      if (project && req.method === "GET" && parts[2] === "check") {
        const list = await project.workspace.list();
        const files = [];
        for (const f of list) {
          // Only source is worth reading into memory for this.
          if (/\.(html|js|css|json|svg|md|txt)$/i.test(f.path)) {
            files.push({ path: f.path, text: (await project.workspace.read(f.path)).text });
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
        const result = checkApp({ files, manifest }, { sdkText: await readSdk() });
        return json(res, 200, { ...result, summary: summarise(result) });
      }

      if (project && req.method === "GET" && parts[2] === "files") {
        return json(res, 200, { files: await project.workspace.list() });
      }

      if (project && req.method === "GET" && parts[2] === "file") {
        const wanted = url.searchParams.get("path") ?? "";
        return json(res, 200, await project.workspace.read(wanted));
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

      // Admin: put points into an account by hand, for a test or a refund.
      // Recorded like any other movement, so it is never invisible in the books.
      if (req.method === "POST" && url.pathname === "/admin/grant") {
        const body = await readJson(req);
        const points = Math.floor(Number(body.points));
        if (!(points > 0)) return json(res, 400, { error: "points must be a positive whole number" });
        const { balance } = await accounts.credit(
          String(body.account ?? "").trim(),
          points,
          { reason: String(body.reason ?? "granted by hand").slice(0, 200) },
          "adjust",
        );
        return json(res, 200, { balancePoints: balance });
      }

      // Admin: the whole points ledger, for reconciling against a provider bill.
      if (req.method === "GET" && url.pathname === "/admin/ledger") {
        return json(res, 200, { lines: accounts.all().slice(-500).reverse() });
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
    if (!config.cmcApiKey) {
      console.log("CMC_API_KEY is not set, so DIVI cannot be priced and nothing can be sold or billed.");
    }
    console.log(`points are paid to ${config.treasuryAddress}`);
  });
}

/** Points a finished turn actually took, for the project's running total. */
function meterSpent(result) {
  return (result?.spent ?? []).reduce((n, s) => n + (Number(s?.points) || 0), 0);
}
