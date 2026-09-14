// The boundary between the game and the places it runs.
//
// Bundles the game the way a door would mount it and reads back EVERY file that
// went into the bundle, including the ones pulled in indirectly. If any of them
// is the wallet or the desktop app's bridge, the game cannot run anywhere but
// the app, and this fails.
//
// Why a bundle and not a search for import lines: a search sees what one file
// says it imports. The bundle sees what actually arrives, three imports deep.
//
// KNOWN lists the ties that still exist while the refactor is under way. It
// only ever shrinks. The check fails on a NEW tie, and it also fails when a
// KNOWN one has quietly gone, so the list cannot rot into a lie. When the list
// is empty, the game is a core.
//
// Run: sh scripts/run-rebels-boundary-tests.sh

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "ui");
const require = createRequire(path.join(UI, "package.json"));
const esbuild = require("esbuild");

/* The entries a door mounts. */
const ENTRIES = [
  { name: "the game core", file: "src/wallet/rebels/platform/coreEntry.ts" },
  /* The web page itself, globe and theme included: the whole of what a
     browser at divi.love/rebels will load. */
  { name: "the web page", file: "src/web-rebels/main.tsx" },
];

/* Files the game must never contain. Paths are relative to ui/. A trailing
   slash means everything under that folder. */
const FORBIDDEN = [
  "src/tauri.ts",
  "src/bridge.ts",
  "src/wallet/bridge.ts",
  "src/wallet/api.ts",
  "src/wallet/value.ts",
  "src/points/",
  "src/wallet/NetworkMap.tsx",
  "src/wallet/knownPeers.ts",
  "src/wallet/stakeWin.ts",
  "src/wallet/exchanges.ts",
  "src/wallet/rebels/platform/app/",
];

/* Ties that still exist. EMPTY since refactor phase A3 (2026-Sep-13): the game
   is a core, and any tie that appears from here on is a regression. */
const KNOWN = {
  "the game core": [],
  "the web page": [],
};

const forbidden = (f) => FORBIDDEN.some((x) => (x.endsWith("/") ? f.startsWith(x) : f === x));

let failures = 0;
const out = [];
const ok = (name, cond, extra = "") => {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
};

for (const entry of ENTRIES) {
  const result = await esbuild.build({
    absWorkingDir: UI,
    entryPoints: [entry.file],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    logLevel: "silent",
    loader: {
      ".json": "json", ".mp3": "empty", ".webp": "empty", ".png": "empty",
      ".jpg": "empty", ".svg": "empty", ".woff2": "empty", ".css": "empty",
    },
    external: ["three", "react", "react-dom", "react-globe.gl", "three/*"],
  });
  const inputs = result.metafile.inputs;
  const files = Object.keys(inputs).filter((f) => !f.startsWith("node_modules/"));
  const bad = files.filter(forbidden).sort();

  /* Who pulled each one in, so a failure says where to look. */
  const importers = (target) =>
    files.filter((f) => (inputs[f].imports ?? []).some((i) => i.path === target));
  const chain = (target) => {
    const seen = new Set([target]);
    const steps = [target];
    let at = target;
    for (let n = 0; n < 12; n++) {
      const up = importers(at).find((f) => !seen.has(f));
      if (!up) break;
      seen.add(up); steps.push(up); at = up;
    }
    return steps.join(" <- ");
  };

  const known = (KNOWN[entry.name] ?? []).slice().sort();
  const fresh = bad.filter((f) => !known.includes(f));
  const gone = known.filter((f) => !bad.includes(f));

  out.push(`${entry.name}: ${files.length} of our files bundled, ${bad.length} tie(s) to the app`);
  for (const f of bad) out.push(`    ${known.includes(f) ? "known" : "NEW  "}  ${chain(f)}`);
  ok(`${entry.name}: no new tie to the wallet or the app bridge`, fresh.length === 0, fresh.join(", "));
  ok(`${entry.name}: the known list is still true (remove what is gone)`, gone.length === 0, gone.join(", "));
}

console.log(out.join("\n"));
console.log(`\n${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
