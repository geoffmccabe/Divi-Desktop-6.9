// Saved projects.
//
// The thing this fixes: a build used to live in memory, in a folder under the
// system temp directory. Restart the service and every project was gone; leave
// it a few days and the operating system cleared the folder out from under it.
// Somebody who spent points building an app would simply lose it, which is the
// worst possible way for this to fail.
//
// So a project is a folder on disk with its files, its conversation and what it
// has cost so far, written as it goes. Closing the wallet, restarting the
// service or coming back next week all land you back where you were.
//
// The conversation is saved with the project because it IS the project: the
// model needs the history to make the next change, and a build you cannot
// continue is barely a saved project at all.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Workspace } from "./workspace.mjs";
import { scaffold } from "./scaffold.mjs";

export class ProjectError extends Error {}

/** Somewhere durable, beside the wallet's own data. Never the temp directory. */
export function defaultRoot() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support/DD69/app-builder");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? home, "DD69/app-builder");
  }
  return path.join(home, ".local/share/DD69/app-builder");
}

const NAME_MAX = 60;

function cleanName(name, fallback = "Untitled app") {
  const s = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!s) return fallback;
  return s.slice(0, NAME_MAX);
}

/**
 * One saved project.
 *
 * `meta.json` holds everything except the app's own files, which live in
 * `files/` and are reached through the same Workspace rules the model writes
 * through, so a project on disk can contain nothing the wallet would refuse to
 * serve later.
 */
export class Project {
  constructor(dir, meta) {
    this.dir = dir;
    this.meta = meta;
    this.workspace = new Workspace(path.join(dir, "files"));
  }

  get id() {
    return this.meta.id;
  }

  get account() {
    return this.meta.account;
  }

  get history() {
    return this.meta.history;
  }

  async save() {
    this.meta.updatedAt = Date.now();
    const tmp = path.join(this.dir, "meta.json.tmp");
    const final = path.join(this.dir, "meta.json");
    // Written aside and moved into place, so a crash mid-write leaves the
    // previous version intact rather than a half-file that will not parse.
    await fs.writeFile(tmp, JSON.stringify(this.meta, null, 2), "utf8");
    await fs.rename(tmp, final);
  }

  /** What the panel needs to list it, without reading every file. */
  summary() {
    return {
      id: this.meta.id,
      name: this.meta.name,
      account: this.meta.account,
      createdAt: this.meta.createdAt,
      updatedAt: this.meta.updatedAt,
      messages: this.meta.history.length,
      pointsSpent: this.meta.pointsSpent ?? 0,
    };
  }
}

export class Projects {
  constructor({ root = defaultRoot() } = {}) {
    this.root = root;
    this.dir = path.join(root, "projects");
    this.byId = new Map();
  }

  /** Read every saved project back in. Safe to call once at start-up. */
  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    let entries;
    try {
      entries = await fs.readdir(this.dir, { withFileTypes: true });
    } catch {
      return this;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(this.dir, e.name);
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
        if (!meta?.id) continue;
        meta.history = Array.isArray(meta.history) ? meta.history : [];
        this.byId.set(meta.id, new Project(dir, meta));
      } catch {
        // One unreadable project must not stop the others loading. It stays on
        // disk untouched rather than being deleted, so it can be looked at.
        this.broken = (this.broken ?? 0) + 1;
      }
    }
    return this;
  }

  async create({ account, name }) {
    const acct = String(account ?? "").trim();
    if (!acct) throw new ProjectError("an account is required");
    const id = randomUUID();
    const dir = path.join(this.dir, id);
    const project = new Project(dir, {
      id,
      account: acct,
      name: cleanName(name),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [],
      pointsSpent: 0,
    });
    await fs.mkdir(dir, { recursive: true });
    await project.workspace.init();
    // A new project is NOT empty. Left empty, the model writes a page that
    // loads an SDK file which does not exist and forgets the manifest, and the
    // result cannot run or be published — which is exactly what happened the
    // first time this was tried end to end.
    await scaffold(project.workspace, { name: project.meta.name, account: acct });
    await project.save();
    this.byId.set(id, project);
    return project;
  }

  get(id) {
    const p = this.byId.get(String(id ?? ""));
    if (!p) throw new ProjectError("that project was not found");
    return p;
  }

  /**
   * One account's projects, newest first.
   *
   * Scoped by account on purpose: projects are listed by who owns them, so a
   * second person on the same service cannot see another's work by guessing.
   */
  list(account) {
    const acct = String(account ?? "").trim();
    return [...this.byId.values()]
      .filter((p) => p.account === acct)
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
      .map((p) => p.summary());
  }

  async rename(id, name) {
    const p = this.get(id);
    p.meta.name = cleanName(name, p.meta.name);
    await p.save();
    return p.summary();
  }

  async remove(id) {
    const p = this.get(id);
    this.byId.delete(p.id);
    await fs.rm(p.dir, { recursive: true, force: true });
    return { removed: p.id };
  }
}
