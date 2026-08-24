import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Projects, ProjectError, defaultRoot } from "../src/projects.mjs";

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dd69-projects-"));
}

test("projects are NOT kept in the temp directory", () => {
  // The bug this whole file exists to fix: builds used to live under the system
  // temp folder, which the operating system clears out. Somebody who spent
  // points building an app would simply lose it.
  const root = defaultRoot();
  assert.ok(!root.startsWith(os.tmpdir()), `${root} must not be inside the temp directory`);
  assert.match(root, /DD69/);
});

test("a project survives the service being restarted", async () => {
  const root = await tempRoot();

  const first = await new Projects({ root }).load();
  const p = await first.create({ account: "alice", name: "My first app" });
  await p.workspace.write("index.html", "<h1>hello</h1>");
  p.meta.history.push({ role: "user", content: "make a hello page" });
  await p.save();

  // Everything above is gone; only the disk remains.
  const second = await new Projects({ root }).load();
  const back = second.get(p.id);
  assert.equal(back.meta.name, "My first app");
  assert.equal((await back.workspace.read("index.html")).text, "<h1>hello</h1>");
  // The conversation comes back too: a build you cannot continue is barely
  // saved at all.
  assert.equal(back.history.length, 1);
  assert.equal(back.history[0].content, "make a hello page");
});

test("projects are listed newest first, and only your own", async () => {
  const root = await tempRoot();
  const projects = await new Projects({ root }).load();
  const a = await projects.create({ account: "alice", name: "One" });
  const b = await projects.create({ account: "alice", name: "Two" });
  await projects.create({ account: "bob", name: "Bob's" });

  b.meta.updatedAt = a.meta.updatedAt + 1000;
  const mine = projects.list("alice");
  assert.deepEqual(mine.map((p) => p.name), ["Two", "One"]);
  // Someone else's work is not listed, even on the same service.
  assert.deepEqual(projects.list("bob").map((p) => p.name), ["Bob's"]);
});

test("a project needs an owner", async () => {
  const projects = await new Projects({ root: await tempRoot() }).load();
  await assert.rejects(() => projects.create({ account: "", name: "x" }), ProjectError);
});

test("an unnamed project still gets a name", async () => {
  const projects = await new Projects({ root: await tempRoot() }).load();
  const p = await projects.create({ account: "alice" });
  assert.equal(p.meta.name, "Untitled app");
  const renamed = await projects.rename(p.id, "  Wallet   Widget  ");
  assert.equal(renamed.name, "Wallet Widget");
});

test("deleting a project removes its files from disk too", async () => {
  const root = await tempRoot();
  const projects = await new Projects({ root }).load();
  const p = await projects.create({ account: "alice", name: "Throwaway" });
  await p.workspace.write("index.html", "<h1>bye</h1>");
  const dir = p.dir;

  await projects.remove(p.id);
  assert.throws(() => projects.get(p.id), ProjectError);
  await assert.rejects(() => fs.stat(dir), /ENOENT/);
});

test("one unreadable project does not stop the others loading", async () => {
  const root = await tempRoot();
  const projects = await new Projects({ root }).load();
  const good = await projects.create({ account: "alice", name: "Good" });

  // A half-written meta file, the shape a crash mid-save would leave.
  const brokenDir = path.join(root, "projects", "broken-one");
  await fs.mkdir(brokenDir, { recursive: true });
  await fs.writeFile(path.join(brokenDir, "meta.json"), "{ not json", "utf8");

  const reloaded = await new Projects({ root }).load();
  assert.equal(reloaded.list("alice").length, 1);
  assert.equal(reloaded.get(good.id).meta.name, "Good");
  assert.equal(reloaded.broken, 1, "and it says one could not be read");
});

test("a project can only hold what the wallet would agree to serve", async () => {
  // Same rules as the bundle server, so the builder cannot happily write a file
  // that the wallet then refuses to run.
  const projects = await new Projects({ root: await tempRoot() }).load();
  const p = await projects.create({ account: "alice", name: "Rules" });
  await assert.rejects(() => p.workspace.write("../escape.html", "x"), /climb out/);
  await assert.rejects(() => p.workspace.write("run.sh", "x"), /not allowed/);
});
