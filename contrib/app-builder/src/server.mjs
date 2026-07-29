// The builder service.
//
// Small on purpose: create a session, send it messages, read back the files the
// model wrote, and preview the result. Everything risky is in the modules this
// file wires together, not here.
//
// Zero dependencies. Node's own http server and fetch are enough, and every
// package not added is one that cannot go bad later.
//
// NOT YET WIRED, and deliberately so:
//   * Identity. Sessions are keyed by an opaque id; binding them to a Divi
//     address signature is the next piece.
//   * Identity is still an opaque id, so screening strikes cannot yet be tied
//     to a real person across restarts.
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

const SESSIONS = new Map();

// One scanner for the process, so the log and the strike counts are shared
// across sessions. Someone who gets blocked, opens a new session and tries again
// should still be the same person as far as this is concerned.
const SCANNER = new Scanner();

export function loadConfig(env = process.env) {
  const diviPerUsd = Number(env.DIVI_PER_USD ?? 0);
  return {
    port: Number(env.PORT ?? 8788),
    // Bound to loopback until the gates exist. Changing this is a deliberate act.
    host: env.HOST ?? "127.0.0.1",
    root: env.BUILDER_ROOT ?? path.join(os.tmpdir(), "dd69-builder"),
    model: env.BUILDER_MODEL ?? "claude-sonnet-5",
    provider: {
      kind: env.BUILDER_PROVIDER ?? "anthropic",
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.BUILDER_BASE_URL,
    },
    // An admin-set number, never a live feed: DIVI price aggregators disagree by
    // roughly 4.5x, so a feed here would be indefensible.
    diviPerUsd,
    startingBalanceDivi: Number(env.BUILDER_TEST_BALANCE ?? 0),
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
  return http.createServer(async (req, res) => {
    try {
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
          sessions: SESSIONS.size,
        });
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
        const id = randomUUID();
        const workspace = new Workspace(path.join(config.root, id));
        await workspace.init();
        SESSIONS.set(id, {
          id,
          workspace,
          meter: new SessionMeter({
            balanceDivi: Number(body.balanceDivi ?? config.startingBalanceDivi),
            diviPerUsd: config.diviPerUsd,
          }),
          history: [],
          // Screening strikes follow the person, not the session, so opening a
          // fresh session is not a way to reset a cool-off.
          accountId: String(body.accountId ?? "local"),
          createdAt: Date.now(),
        });
        return json(res, 201, { id });
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
        const screen = SCANNER.scan(message, { accountId: session.accountId });
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
  });
}
