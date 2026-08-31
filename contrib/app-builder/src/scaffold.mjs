// What a new project starts with.
//
// An empty folder is the wrong starting point. Asked to build from nothing, the
// model writes an index.html that loads `sdk.js` — because that is how every
// example works — and forgets manifest.json entirely. The result references a
// file that does not exist and cannot be published. That is not the model being
// careless; it is us handing it a blank folder and hoping.
//
// So every project begins with the three things an app cannot work without: the
// SDK it talks to the wallet through, a manifest that already parses, and a page
// that already runs. The developer's first message then changes something that
// works, rather than creating something from nothing.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The SDK, from the one canonical copy.
 *
 * The wallet's own built-in apps compile this exact file in, so an app built
 * here and an app shipped with the wallet talk to it through identical code.
 */
export const SDK_PATH = path.join(HERE, "..", "assets", "sdk.js");

export async function readSdk() {
  return fs.readFile(SDK_PATH, "utf8");
}

/** Divi addresses are base58 with version byte 30, so they start with D. */
const ADDRESS_RE = /^D[1-9A-HJ-NP-Za-km-z]{25,40}$/;

/** Turn "My Balance Card" into "balance-card", the shape an app id needs. */
export function slug(name) {
  const s = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "untitled";
}

export function starterManifest({ name, account }) {
  return {
    schema: 1,
    id: `app.${slug(name)}`,
    name: String(name ?? "Untitled app").slice(0, 48),
    version: "0.1.0",
    author: {
      name: "Unnamed developer",
      // The account IS a Divi address when someone is signed in with one, which
      // is also where money for this app would go. A placeholder is only used
      // when there is no address to use, and it has to be replaced before this
      // can be published.
      address: ADDRESS_RE.test(account) ? account : "DReplaceThisWithYourOwnDiviAddress1",
    },
    description: "A new app, not described yet.",
    permissions: [],
    network: [],
    display: { immersive: "on-demand" },
    media: { thumbnail: "thumb.svg" },
    price: { model: "free" },
  };
}

const STARTER_HTML = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>New app</title>
<link rel="stylesheet" href="style.css">
<main>
  <h1>Your new app</h1>
  <p id="hello">Say what you want this to do, and it will be built here.</p>
</main>
<script src="sdk.js"></script>
<script src="app.js"></script>
`;

const STARTER_JS = `// Everything the wallet can do for you lives on window.divi, from sdk.js.
// Nothing works until the matching permission is listed in manifest.json AND
// the person running the app has agreed to it.
//
//   await divi.balance()        needs "balance.read"
//   await divi.chain(5)         needs "chain.read"
//   await divi.storage.set(k,v) needs "storage"
//   await divi.notify("hi")     needs "notify"

async function main() {
  // Nothing is asked for yet, so there is nothing to load.
}

main().catch((e) => {
  document.getElementById("hello").textContent = e.message;
});
`;

const STARTER_CSS = `/* Your app inherits the wallet's own look automatically: colours, fonts and
   spacing arrive as CSS variables and follow whatever skin the person is using.
   Use the variables rather than fixed colours and the app matches the wallet on
   every theme, including ones nobody has made yet. */

body {
  margin: 0;
  padding: 24px;
  font-family: var(--font-body, system-ui, sans-serif);
  color: hsl(var(--foreground, 0 0% 95%));
  background: transparent;
}

h1 {
  font-family: var(--font-heading, inherit);
  font-size: 1.4rem;
  margin: 0 0 12px;
}

p { line-height: 1.5; color: hsl(var(--foreground, 0 0% 95%) / 0.7); }
`;

const STARTER_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200">
  <rect width="300" height="200" fill="#1b1a20"/>
  <text x="150" y="105" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#9b7fd4">New app</text>
</svg>
`;

/**
 * Bring an existing project's SDK up to date.
 *
 * The SDK is OURS, not the app's — apps may not edit it, and the code check
 * fails one that has been changed. So replacing it is safe, and necessary:
 * a project built last week carries last week's SDK, and would silently miss
 * anything added since. That is not hypothetical — projects made before the
 * SDK learned to apply the wallet's colours came out looking like nothing.
 *
 * Returns true if it actually changed.
 */
export async function refreshSdk(workspace) {
  const canonical = await readSdk();
  try {
    const current = await workspace.read("sdk.js");
    if (current.text === canonical) return false;
  } catch {
    // Not there at all, which is worse. Write it.
  }
  await workspace.write("sdk.js", canonical);
  return true;
}

/**
 * Write the starting files into a fresh project.
 * Never overwrites: scaffolding an existing project must not destroy work.
 */
export async function scaffold(workspace, { name, account }) {
  const existing = new Set((await workspace.list()).map((f) => f.path));
  const files = [
    ["sdk.js", await readSdk()],
    ["manifest.json", JSON.stringify(starterManifest({ name, account }), null, 2) + "\n"],
    ["index.html", STARTER_HTML],
    ["app.js", STARTER_JS],
    ["style.css", STARTER_CSS],
    ["thumb.svg", STARTER_THUMB],
  ];
  const written = [];
  for (const [p, content] of files) {
    if (existing.has(p)) continue;
    await workspace.write(p, content);
    written.push(p);
  }
  return written;
}
