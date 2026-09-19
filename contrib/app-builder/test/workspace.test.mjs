import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Workspace, WorkspaceError, LIMITS } from "../src/workspace.mjs";

async function tmpWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dd69-ws-"));
  const ws = new Workspace(path.join(dir, "project"));
  await ws.init();
  return { ws, dir };
}

test("writes and reads a file", async () => {
  const { ws } = await tmpWorkspace();
  await ws.write("index.html", "<h1>hi</h1>");
  assert.equal((await ws.read("index.html")).text, "<h1>hi</h1>");
});

test("refuses to climb out of the project", async () => {
  const { ws } = await tmpWorkspace();
  for (const bad of [
    "../escape.html",
    "a/../../escape.html",
    "/etc/passwd.html",
    "..",
    "./../x.html",
    "sub/../../../x.html",
  ]) {
    await assert.rejects(() => ws.write(bad, "x"), WorkspaceError, `${bad} was allowed`);
  }
});

test("a symlink pointing outside cannot be written through", async () => {
  const { ws, dir } = await tmpWorkspace();
  const outside = path.join(dir, "outside");
  await fs.mkdir(outside, { recursive: true });
  // A link inside the project pointing at a directory outside it.
  await fs.symlink(outside, path.join(ws.root, "link"));
  await assert.rejects(() => ws.write("link/../../outside/evil.html", "x"), WorkspaceError);
});

test("refuses file types that do not belong in a bundle", async () => {
  const { ws } = await tmpWorkspace();
  for (const bad of ["run.sh", "wallet.dat", "app.exe", "noext"]) {
    await assert.rejects(() => ws.write(bad, "x"), WorkspaceError, `${bad} was allowed`);
  }
});

test("refuses hidden files", async () => {
  const { ws } = await tmpWorkspace();
  await assert.rejects(() => ws.write(".env.json", "x"), WorkspaceError);
  await assert.rejects(() => ws.write("sub/.secret.json", "x"), WorkspaceError);
});

test("enforces the per-file size limit", async () => {
  const { ws } = await tmpWorkspace();
  const big = "a".repeat(LIMITS.maxFileBytes + 1);
  await assert.rejects(() => ws.write("big.txt", big), WorkspaceError);
});

test("enforces the file count limit", async () => {
  const { ws } = await tmpWorkspace();
  for (let i = 0; i < LIMITS.maxFiles; i++) await ws.write(`f${i}.txt`, "x");
  await assert.rejects(() => ws.write("one-too-many.txt", "x"), WorkspaceError);
});

test("overwriting an existing file does not count as a new one", async () => {
  const { ws } = await tmpWorkspace();
  for (let i = 0; i < LIMITS.maxFiles; i++) await ws.write(`f${i}.txt`, "x");
  // At the file limit, but rewriting an existing path must still work.
  await ws.write("f0.txt", "updated");
  assert.equal((await ws.read("f0.txt")).text, "updated");
});

test("lists files with sizes and removes them", async () => {
  const { ws } = await tmpWorkspace();
  await ws.write("a.html", "12345");
  await ws.write("sub/b.css", "body{}");
  const list = await ws.list();
  assert.deepEqual(list.map((f) => f.path), ["a.html", "sub/b.css"]);
  assert.equal(list[0].bytes, 5);
  await ws.remove("a.html");
  assert.deepEqual((await ws.list()).map((f) => f.path), ["sub/b.css"]);
});

test("reading a missing file is an error, not empty content", async () => {
  const { ws } = await tmpWorkspace();
  await assert.rejects(() => ws.read("nope.html"), WorkspaceError);
});
