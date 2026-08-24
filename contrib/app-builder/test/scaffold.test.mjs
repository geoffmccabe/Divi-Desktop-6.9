import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Workspace } from "../src/workspace.mjs";
import { scaffold, starterManifest, slug, readSdk, SDK_PATH } from "../src/scaffold.mjs";
import { THEME_VARS, stylingBrief } from "../src/theme.mjs";
import { CAPABILITIES, capabilityBrief } from "../src/capabilities.mjs";
import { SYSTEM_PROMPT } from "../src/agent.mjs";

async function ws() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dd69-scaffold-"));
  const w = new Workspace(dir);
  await w.init();
  return w;
}

test("a new project can run and be published from the very first moment", async () => {
  const w = await ws();
  await scaffold(w, { name: "Balance Card", account: "DCrZS49xZKUZ778gobc2izpE4tmeuiJGZH" });
  const names = (await w.list()).map((f) => f.path).sort();
  assert.deepEqual(names, ["app.js", "index.html", "manifest.json", "sdk.js", "style.css", "thumb.svg"]);

  // The page loads the SDK, and the SDK is actually there. That combination
  // failing is exactly what the first real build produced.
  const html = (await w.read("index.html")).text;
  assert.match(html, /src="sdk\.js"/);
  assert.ok((await w.read("sdk.js")).text.includes("window.divi"));
});

test("the starter manifest is valid, and uses the developer's own address", () => {
  const m = starterManifest({ name: "My Balance Card", account: "DCrZS49xZKUZ778gobc2izpE4tmeuiJGZH" });
  assert.equal(m.schema, 1);
  assert.equal(m.id, "app.my-balance-card");
  // Money for an app goes to its author, so the address is the one they are
  // signed in with rather than something they must remember to change.
  assert.equal(m.author.address, "DCrZS49xZKUZ778gobc2izpE4tmeuiJGZH");
  assert.deepEqual(m.permissions, [], "a new app asks for nothing until it needs something");
  assert.equal(m.price.model, "free");
});

test("without a real address the manifest says so rather than inventing one", () => {
  const m = starterManifest({ name: "x", account: "local" });
  assert.match(m.author.address, /ReplaceThis/i);
});

test("odd names still make a usable app id", () => {
  assert.equal(slug("  Geoff's  Wallet Widget!! "), "geoff-s-wallet-widget");
  assert.equal(slug(""), "untitled");
  assert.equal(slug("!!!"), "untitled");
});

test("scaffolding never overwrites work already done", async () => {
  const w = await ws();
  await w.write("index.html", "<h1>mine</h1>");
  const written = await scaffold(w, { name: "Kept", account: "local" });
  assert.ok(!written.includes("index.html"));
  assert.equal((await w.read("index.html")).text, "<h1>mine</h1>");
});

test("the SDK given to new projects is the same one the wallet ships", async () => {
  // There used to be a copy per app, which is how two versions of a protocol
  // shim quietly stop agreeing. The Rust side compiles in this exact file.
  const community = path.join(SDK_PATH, "..", "..", "..", "..", "crates", "app", "src", "community.rs");
  const rust = await fs.readFile(community, "utf8");
  assert.match(rust, /include_bytes!\("\.\.\/\.\.\/\.\.\/contrib\/app-builder\/assets\/sdk\.js"\)/);
  assert.match(await readSdk(), /divi\.app\.v1/);
});

test("every wallet theme variable is described to the model", async () => {
  // If a variable is added to the wallet and not described here, apps built
  // from now on simply will not use it, and they drift out of the skin system
  // one release at a time.
  const tokens = await fs.readFile(
    path.join(SDK_PATH, "..", "..", "..", "..", "ui", "src", "theme", "tokens.ts"),
    "utf8",
  );
  const declared = new Set(THEME_VARS.map(([v]) => v));
  const inWallet = [...tokens.matchAll(/cssVar:\s*"(--[a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(inWallet.length > 10, "the token file should have been read");
  const missing = inWallet.filter((v) => !declared.has(v));
  assert.deepEqual(missing, [], `these wallet theme variables are not described to the model: ${missing}`);
});

test("the styling brief forbids the one thing that breaks skins", () => {
  const brief = stylingBrief();
  assert.match(brief, /Never write a hex colour/i);
  assert.match(brief, /hsl\(var\(--foreground\)\)/);
});

test("the model is only told about capabilities that actually work", () => {
  const brief = capabilityBrief();
  // Everything offered must be a permission the broker will honour.
  const known = new Set([
    "balance.read", "addresses.read", "history.read", "staking.read", "collectibles.read",
    "tokens.read", "network.read", "chain.read", "storage", "payment.request", "network",
    "clipboard.write", "notify",
  ]);
  for (const c of CAPABILITIES) {
    assert.ok(known.has(c.permission), `${c.permission} is not a permission the wallet has`);
  }
  // And the things that do not work are named as not working, so the model does
  // not write code around them.
  assert.match(brief, /NOT AVAILABLE/);
  assert.match(brief, /Divi Meta Token/);
  assert.match(brief, /no internet access|no fetch|There is no internet/i);
});

test("every build request carries the styling rules and the capability list", () => {
  // Geoff's requirement: a developer should not have to think about styling or
  // go looking for what the wallet can do.
  assert.match(SYSTEM_PROMPT, /Never write a hex colour/i);
  assert.match(SYSTEM_PROMPT, /await divi\.balance\(\)/);
  assert.match(SYSTEM_PROMPT, /NEVER rewrite or edit this/);
});
