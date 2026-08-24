import { useCallback, useEffect, useRef, useState } from "react";
import "./builder.css";
import {
  builderUrl, setBuilderUrl, health, setKey,
  createProject, listProjects, openProject, deleteProject,
  sendMessage, readFile, checkProject,
  type Account, type BuilderFile, type CheckFinding, type Health,
  type ProjectSummary, type TurnEvent,
} from "./api";
import { PointsChip, BuyPointsButton, pointsAccount } from "../points/BuyPoints";
import { setCmcKey } from "../points/api";
import { getValueSettings } from "../wallet/value";

// App Builder: describe an app, a model writes it, and points pay for the work.
//
// Points are bought with DIVI up front (see ui/src/points/). The balance lives
// on the service, not here, so nothing in this panel can add to it.
//
// Work is organised into PROJECTS, saved on disk as they go. An earlier version
// kept a build in memory in a temp folder, so closing the wallet threw away
// something somebody had paid to make. Everything here assumes you will come
// back to a build later, because you will.

type Line =
  | { kind: "you"; text: string }
  | { kind: "ai"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "cost"; text: string }
  | { kind: "err"; text: string };

export function BuilderPanel() {
  const [probe, setProbe] = useState<{ state: "checking" | "up" | "down"; health?: Health; error?: string }>({
    state: "checking",
  });
  const [account, setAccount] = useState<string>("");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [open, setOpen] = useState<ProjectSummary | null>(null);
  const [spend, setSpend] = useState<Account | null>(null);
  const [files, setFiles] = useState<BuilderFile[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ path: string; text: string } | null>(null);
  const [check, setCheck] = useState<{ summary: string; findings: CheckFinding[] } | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const probeService = useCallback(() => {
    setProbe({ state: "checking" });
    // Hand over the CoinMarketCap key the wallet already holds. Without a DIVI
    // price nothing can be billed, so the service refuses to start a project —
    // and there is deliberately no second price source to fall back to.
    const cmc = getValueSettings().cmcKey?.trim();
    const ready = cmc ? setCmcKey(cmc).catch(() => {}) : Promise.resolve();
    ready
      .then(health)
      .then((h) => setProbe({ state: "up", health: h }))
      .catch((e) => setProbe({ state: "down", error: e?.message ?? "no answer" }));
  }, []);

  useEffect(probeService, [probeService]);

  // Work out who we are once. Doing this inside the refresh made the refresh
  // change identity the moment it ran, so the list was fetched twice on open.
  useEffect(() => {
    void pointsAccount().then(setAccount);
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!account) return;
    const r = await listProjects(account);
    setProjects(r.projects);
  }, [account]);

  useEffect(() => {
    if (probe.state === "up" && account) void refreshProjects().catch(() => setProjects([]));
  }, [probe.state, account, refreshProjects]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const start = async (name: string) => {
    const who = account || (await pointsAccount());
    const p = await createProject(who, name);
    setOpen(p);
    setFiles([]);
    setCheck(null);
    // Spend is per open project. Left over, it would show the last project's
    // total against this one, which is a number about money being wrong.
    setSpend(null);
    setLines([{ kind: "ai", text: "Ready. Describe the app you want and I will build it." }]);
    void refreshProjects();
  };

  const resume = async (summary: ProjectSummary) => {
    const detail = await openProject(summary.id);
    setOpen(detail);
    setFiles(detail.files);
    setCheck(null);
    setSpend(null);
    // Replay what was said last time, so opening a project shows the build
    // rather than an empty box above a half-finished app.
    setLines(
      detail.history.length
        ? detail.history.flatMap(replayEntry)
        : [{ kind: "ai" as const, text: "Nothing said yet. Describe the app you want." }],
    );
  };

  const leave = () => {
    setOpen(null);
    setViewing(null);
    setCheck(null);
    setSpend(null);
    void refreshProjects();
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || !open || busy) return;
    if (!probe.health?.keyConfigured) {
      setLines((l) => [...l, { kind: "err", text: "Add an Anthropic key above before building." }]);
      return;
    }
    setDraft("");
    setLines((l) => [...l, { kind: "you", text: message }]);
    setBusy(true);
    setCheck(null);
    try {
      const r = await sendMessage(open.id, message);
      const added: Line[] = [];
      for (const e of r.events) added.push(...renderEvent(e));
      if (r.stopped === "step_limit") {
        added.push({ kind: "err", text: "Stopped after too many steps without finishing. Ask for a smaller change." });
      }
      if (r.stopped === "refused") {
        added.push({ kind: "err", text: r.reason ?? "That request was not accepted." });
      }
      setLines((l) => [...l, ...added]);
      setFiles(r.files);
      setSpend(r.account);
    } catch (e) {
      setLines((l) => [...l, { kind: "err", text: (e as Error).message }]);
    } finally {
      setBusy(false);
      void refreshProjects();
    }
  };

  if (probe.state === "checking") {
    return <div className="bd"><p className="bd-note">Looking for the builder service…</p></div>;
  }
  if (probe.state === "down") return <Offline error={probe.error} onRetry={probeService} />;

  // The AI key is needed to BUILD, not to look. Blocking the whole panel on it
  // hid every saved app behind a password box, which flatly contradicts telling
  // someone their work is safe on disk. It is a banner now, and only sending is
  // held back.
  const needsKey = !probe.health?.keyConfigured;

  return (
    <div className="bd">
      <div className="bd-bar">
        {open ? (
          <>
            <button type="button" className="wl-btn" onClick={leave}>← All apps</button>
            <div className="bd-stat"><b>{open.name}</b><span>{files.length} files</span></div>
          </>
        ) : (
          <div className="bd-stat"><b className="bd-good">Connected</b><span>{probe.health?.model}</span></div>
        )}
        <span className="bd-spacer" />
        {spend && open && (
          <div className="bd-stat">
            <b>{spend.spentPoints.toLocaleString()} points</b>
            <span>this session</span>
          </div>
        )}
        <PointsChip />
        {open && (
          <button
            type="button"
            className="wl-btn"
            disabled={busy || files.length === 0}
            onClick={() => void checkProject(open.id).then(setCheck).catch(() => setCheck(null))}
          >
            Check
          </button>
        )}
      </div>

      {needsKey && <KeyBox onSaved={probeService} />}

      {!open ? (
        <ProjectList projects={projects} onStart={start} onOpen={resume} onDelete={async (id) => {
          await deleteProject(id);
          void refreshProjects();
        }} />
      ) : (
        <div className="bd-split">
          <div className="bd-chat">
            <div className="bd-log" ref={logRef}>
              {lines.map((l, i) => (
                <div key={i} className={`bd-msg bd-msg-${l.kind}`}>{l.text}</div>
              ))}
              {busy && <div className="bd-msg bd-msg-tool">Working…</div>}
            </div>
            <div className="bd-compose">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
                }}
                placeholder="Describe the app, or the change you want next…"
                disabled={busy}
              />
              <button
                type="button"
                className="wl-btn wl-btn-primary"
                disabled={busy || needsKey || !draft.trim()}
                title={needsKey ? "Add an Anthropic key above before building" : undefined}
                onClick={send}
              >
                Send
              </button>
            </div>
          </div>

          <div className="bd-files">
            <h4>Files</h4>
            {files.length === 0 ? (
              <p className="bd-empty">Nothing written yet.</p>
            ) : (
              files.map((f) => (
                <button
                  type="button"
                  className="bd-file"
                  key={f.path}
                  onClick={() => void readFile(open.id, f.path).then(setViewing).catch(() => {})}
                >
                  <span className="bd-file-name">{f.path}</span>
                  <span className="bd-file-size">{f.bytes}</span>
                </button>
              ))
            )}
            {check && (
              <div className="bd-check">
                <h4>Check</h4>
                <p className={check.findings.some((f) => f.severity === "fail") ? "bd-bad" : "bd-note"}>
                  {check.summary}
                </p>
                {check.findings.map((f, i) => (
                  <p key={i} className="bd-finding">
                    <b>{f.severity === "fail" ? "Must fix" : "Worth a look"}:</b> {f.why} <i>({f.where})</i>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewing && <FileView file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ProjectList({ projects, onStart, onOpen, onDelete }: {
  projects: ProjectSummary[] | null;
  onStart: (name: string) => Promise<void>;
  onOpen: (p: ProjectSummary) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const begin = async () => {
    setErr(null);
    try {
      await onStart(name.trim());
      setName("");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="bd-projects">
      <div className="bd-newrow">
        <input
          className="wl-input"
          value={name}
          placeholder="Name your app, e.g. Staking Dashboard"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void begin(); }}
        />
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => void begin()}>
          New app
        </button>
      </div>
      {err && <p className="bd-note bd-bad">{err}</p>}

      {projects === null ? (
        <p className="bd-note">Loading your apps…</p>
      ) : projects.length === 0 ? (
        <div className="bd-note bd-firstrun">
          <p>
            Nothing built yet. Name an app above and describe what it should do —
            the model writes the files, you pay in points for what it uses, and
            the work is saved as it goes so you can come back to it.
          </p>
          <p className="bd-buyrow"><BuyPointsButton label="Buy points with DIVI" /></p>
        </div>
      ) : (
        projects.map((p) => (
          <div className="bd-project" key={p.id}>
            <button type="button" className="bd-project-main" onClick={() => void onOpen(p)}>
              <span className="bd-project-name">{p.name}</span>
              <span className="bd-project-meta">
                {p.messages} message{p.messages === 1 ? "" : "s"} · {p.pointsSpent.toLocaleString()} points · {when(p.updatedAt)}
              </span>
            </button>
            <button
              type="button"
              className="wl-btn bd-project-del"
              title="Delete this app"
              onClick={() => void onDelete(p.id)}
            >
              Delete
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function FileView({ file, onClose }: { file: { path: string; text: string }; onClose: () => void }) {
  return (
    <div className="bd-viewer">
      <div className="bd-viewer-head">
        <b>{file.path}</b>
        <button type="button" className="wl-btn" onClick={onClose}>Close</button>
      </div>
      <pre className="bd-viewer-body">{file.text}</pre>
    </div>
  );
}

function KeyBox({ onSaved }: { onSaved: () => void }) {
  const [key, setKey_] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await setKey(key.trim());
      setKey_("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bd-offline bd-keybox">
      <h3>Add an Anthropic key to build</h3>
      <p className="bd-note">
        Once each time the builder service is started. The key is kept in memory,
        never written to a file, and never sent anywhere except Anthropic. Your
        saved apps are listed below either way.
      </p>
      <div className="bd-bar bd-bar-plain">
        <input
          className="wl-input"
          type="password"
          placeholder="sk-ant-..."
          value={key}
          onChange={(e) => setKey_(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Anthropic key"
        />
        <button type="button" className="wl-btn wl-btn-primary" disabled={busy || key.trim().length < 20} onClick={save}>
          Save
        </button>
      </div>
      {err && <p className="bd-note bd-bad bd-note-gap">{err}</p>}
    </div>
  );
}

/** Turn a saved conversation entry back into chat lines. */
function replayEntry(entry: { role: string; content: unknown }): Line[] {
  if (typeof entry.content === "string") {
    return [{ kind: entry.role === "user" ? "you" : "ai", text: entry.content }];
  }
  const blocks = Array.isArray(entry.content) ? entry.content : [];
  const out: Line[] = [];
  for (const b of blocks as Array<Record<string, unknown>>) {
    if (b.type === "text" && typeof b.text === "string") out.push({ kind: "ai", text: b.text });
    else if (b.type === "tool_use") {
      const p = (b.input as { path?: string })?.path;
      out.push({ kind: "tool", text: `${String(b.name)}${p ? ` ${p}` : ""}` });
    }
    // Tool results are the model's own working, not worth replaying at people.
  }
  return out;
}

function renderEvent(e: TurnEvent): Line[] {
  switch (e.type) {
    case "message":
      return e.text ? [{ kind: "ai", text: e.text }] : [];
    case "tool":
      return [{ kind: "tool", text: `${e.name}${e.path ? ` ${e.path}` : ""}` }];
    case "usage":
      return [{ kind: "cost", text: `step ${e.step}: ${e.points.toLocaleString()} points` }];
    case "billing_stopped":
      return [{ kind: "err", text: `Stopped: ${e.reason}` }];
    case "step_limit":
      return [];
    case "error":
      return [{ kind: "err", text: e.message }];
    default:
      return [];
  }
}

function when(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString();
}

function Offline({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const [url, setUrl] = useState(builderUrl());
  return (
    <div className="bd">
      <div className="bd-offline">
        <h3>App Builder is not switched on</h3>
        <p className="bd-note">
          The part that talks to the AI runs alongside the wallet, and it is not
          running at the moment. Nothing is broken and nothing has been lost —
          your saved apps are on disk and will be here when it comes back.
        </p>
        {error && <p className="bd-note bd-bad bd-note-gap">Details: {error}</p>}
        <div className="bd-bar bd-bar-plain">
          <input
            className="wl-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            aria-label="Builder service address"
          />
          <button type="button" className="wl-btn" onClick={() => { setBuilderUrl(url); onRetry(); }}>
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}
