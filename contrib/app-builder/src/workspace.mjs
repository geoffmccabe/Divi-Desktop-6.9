// The only place the model is allowed to write.
//
// Every file operation the agent performs goes through here, so the blast radius
// of a jailbroken prompt is "it wrote a bad app in its own folder" rather than
// anything else on the machine. The rules mirror the wallet's bundle rules in
// crates/supervisor/src/appbundle.rs on purpose: a file the builder happily
// writes but the wallet then refuses to serve is a confusing dead end for a
// developer, so both ends agree on what a bundle may contain.
//
// Deliberately zero dependencies. This service handles untrusted input and
// spends real money, and every package added here is another thing that has to
// be trusted (see the postcss incident).

import { promises as fs } from "node:fs";
import path from "node:path";

/** Only these may be written. Anything else is refused rather than guessed at. */
export const ALLOWED_EXT = new Set([
  "html", "js", "css", "json", "svg", "png", "jpg", "jpeg", "webp", "gif",
  "mp4", "webm", "woff2", "md", "txt",
]);

export const LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxFiles: 200,
  maxPathLength: 160,
  maxDepth: 6,
};

export class WorkspaceError extends Error {}

/**
 * Resolve a model-supplied path to a real path inside the project, or throw.
 *
 * Works on resolved components rather than string matching, so an encoded or
 * unusually spelled traversal cannot slip past, and re-checks the final resolved
 * path against the root so a symlink cannot point out of the project either.
 */
function resolveInside(root, requested) {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new WorkspaceError("a path is required");
  }
  if (requested.length > LIMITS.maxPathLength) {
    throw new WorkspaceError("that path is too long");
  }
  if (requested.includes("\0")) {
    throw new WorkspaceError("that path is not valid");
  }

  // An absolute path from the model is refused rather than quietly treated as
  // relative. Stripping the slash would be safe (it would land inside the
  // project either way), but it would hide a model that thinks it is writing to
  // /etc, and a confused model is worth seeing rather than silently correcting.
  // Note this is deliberately stricter than the wallet's serving rules, where a
  // leading slash is normal because those paths come from urls.
  if (/^[/\\]/.test(requested) || /^[A-Za-z]:/.test(requested)) {
    throw new WorkspaceError("use a path relative to the app, not an absolute one");
  }

  const parts = requested.split(/[/\\]+/).filter((p) => p.length > 0);
  if (parts.length === 0) throw new WorkspaceError("a file name is required");
  if (parts.length > LIMITS.maxDepth) throw new WorkspaceError("that path is nested too deeply");
  for (const p of parts) {
    if (p === "." || p === "..") throw new WorkspaceError("paths cannot climb out of the project");
    if (p.startsWith(".")) throw new WorkspaceError("hidden files are not allowed");
    if (!/^[A-Za-z0-9._-]+$/.test(p)) throw new WorkspaceError(`"${p}" is not a valid file name`);
  }

  const ext = path.extname(parts[parts.length - 1]).slice(1).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new WorkspaceError(`".${ext}" files are not allowed in an app bundle`);
  }

  const full = path.resolve(root, parts.join(path.sep));
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new WorkspaceError("paths cannot climb out of the project");
  }
  return { full, rel: parts.join("/") };
}

export class Workspace {
  /** @param {string} root absolute path to this session's project directory */
  constructor(root) {
    this.root = path.resolve(root);
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async list() {
    const out = [];
    const walk = async (dir, prefix) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
        else if (e.isFile()) {
          const st = await fs.stat(path.join(dir, e.name));
          out.push({ path: rel, bytes: st.size });
        }
      }
    };
    await walk(this.root, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async totalBytes() {
    return (await this.list()).reduce((n, f) => n + f.bytes, 0);
  }

  async read(requested) {
    const { full, rel } = resolveInside(this.root, requested);
    try {
      const buf = await fs.readFile(full);
      return { path: rel, text: buf.toString("utf8") };
    } catch {
      throw new WorkspaceError(`${rel} does not exist`);
    }
  }

  async write(requested, content) {
    const { full, rel } = resolveInside(this.root, requested);
    if (typeof content !== "string") throw new WorkspaceError("content must be text");

    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > LIMITS.maxFileBytes) {
      throw new WorkspaceError(`${rel} is larger than the ${LIMITS.maxFileBytes} byte limit`);
    }

    const existing = await this.list();
    const isNew = !existing.some((f) => f.path === rel);
    if (isNew && existing.length >= LIMITS.maxFiles) {
      throw new WorkspaceError(`an app may contain at most ${LIMITS.maxFiles} files`);
    }
    const priorBytes = existing.find((f) => f.path === rel)?.bytes ?? 0;
    const total = existing.reduce((n, f) => n + f.bytes, 0) - priorBytes + bytes;
    if (total > LIMITS.maxTotalBytes) {
      throw new WorkspaceError("the app is larger than the total size limit");
    }

    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    return { path: rel, bytes };
  }

  async remove(requested) {
    const { full, rel } = resolveInside(this.root, requested);
    try {
      await fs.unlink(full);
    } catch {
      throw new WorkspaceError(`${rel} does not exist`);
    }
    return { path: rel };
  }
}

export const _internals = { resolveInside };
