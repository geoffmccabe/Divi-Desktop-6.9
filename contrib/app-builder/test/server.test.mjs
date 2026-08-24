import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { createServer, loadConfig } from "../src/server.mjs";

function listen(config) {
  const server = createServer(config);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const baseEnv = {
  BUILDER_ROOT: path.join(os.tmpdir(), `dd69-srv-${Date.now()}`),
  ANTHROPIC_API_KEY: "test-key-not-used",
};

test("health reports what is configured", async () => {
  const { server, base } = await listen(loadConfig({ ...baseEnv, DIVI_PER_USD: "100" }));
  const r = await (await fetch(`${base}/health`)).json();
  assert.equal(r.ok, true);
  assert.equal(r.rateConfigured, true);
  server.close();
});

test("without a DIVI rate the builder refuses to open a session", async () => {
  // A builder that cannot bill must not take work: the alternative is spending
  // real money with no way to charge for it.
  const { server, base } = await listen(loadConfig({ ...baseEnv, DIVI_PER_USD: "0" }));
  const res = await fetch(`${base}/session`, { method: "POST" });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(body.error, /rate has not been set/);
  server.close();
});

test("creates a session and starts with no files", async () => {
  const { server, base } = await listen(loadConfig({ ...baseEnv, DIVI_PER_USD: "100" }));
  const created = await (
    await fetch(`${base}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "tester" }),
    })
  ).json();
  assert.ok(created.id);

  const files = await (await fetch(`${base}/session/${created.id}/files`)).json();
  assert.deepEqual(files.files, []);
  server.close();
});

test("an unknown session is a 404, not an empty success", async () => {
  const { server, base } = await listen(loadConfig({ ...baseEnv, DIVI_PER_USD: "100" }));
  const res = await fetch(`${base}/session/does-not-exist/files`);
  assert.equal(res.status, 404);
  server.close();
});

test("an empty message is refused before any model call", async () => {
  const { server, base } = await listen(loadConfig({ ...baseEnv, DIVI_PER_USD: "100" }));
  const created = await (
    await fetch(`${base}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "tester" }),
    })
  ).json();
  const res = await fetch(`${base}/session/${created.id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(res.status, 400);
  server.close();
});
