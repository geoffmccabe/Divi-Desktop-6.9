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
  // Only ever checked for presence in these tests; nothing here calls out.
  CMC_API_KEY: "cmc-key-not-used",
};

test("health reports what is configured", async () => {
  const { server, base } = await listen(loadConfig(baseEnv));
  const r = await (await fetch(`${base}/health`)).json();
  assert.equal(r.ok, true);
  assert.equal(r.rateConfigured, true);
  server.close();
});

test("points can be spent with no DIVI price at all", async () => {
  // Points are already a fixed amount of money, so spending them needs no
  // exchange rate. The price is only needed to SELL points for DIVI. Requiring
  // it to build meant somebody holding 20,000 points could not use them.
  const { server, base } = await listen(loadConfig({ ...baseEnv, CMC_API_KEY: "" }));
  const res = await fetch(`${base}/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: "tester", name: "No price needed" }),
  });
  assert.equal(res.status, 201);
  server.close();
});

test("but points cannot be SOLD without a price, and it says so", async () => {
  const { server, base } = await listen(loadConfig({ ...baseEnv, CMC_API_KEY: "" }));
  const cat = await (await fetch(`${base}/points/catalogue`)).json();
  assert.equal(cat.available, false);
  assert.match(cat.why, /CoinMarketCap/);
  server.close();
});

test("a new project starts with the files an app cannot work without", async () => {
  const { server, base } = await listen(loadConfig(baseEnv));
  const created = await (
    await fetch(`${base}/project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "tester", name: "First app" }),
    })
  ).json();
  assert.ok(created.id);

  const files = await (await fetch(`${base}/project/${created.id}/files`)).json();
  const names = files.files.map((f) => f.path).sort();
  // Starting empty is what produced a first build that referenced an SDK file
  // which did not exist and had no manifest at all.
  assert.deepEqual(names, ["app.js", "index.html", "manifest.json", "sdk.js", "style.css", "thumb.svg"]);
  server.close();
});

test("an unknown project is a 404, not an empty success", async () => {
  const { server, base } = await listen(loadConfig(baseEnv));
  const res = await fetch(`${base}/project/does-not-exist/files`);
  assert.equal(res.status, 404);
  server.close();
});

test("an empty message is refused before any model call", async () => {
  const { server, base } = await listen(loadConfig(baseEnv));
  const created = await (
    await fetch(`${base}/project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: "tester", name: "First app" }),
    })
  ).json();
  const res = await fetch(`${base}/project/${created.id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(res.status, 400);
  server.close();
});
