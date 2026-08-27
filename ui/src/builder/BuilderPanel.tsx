import { useCallback, useEffect, useRef, useState } from "react";
import "./builder.css";
import {
  builderUrl, setBuilderUrl, health,
  createProject, listProjects, openProject, deleteProject,
  sendMessage, readFile, checkProject, listFiles, serviceStatus, restartService,
  type Account, type BuilderFile, type CheckFinding, type Health,
  type ProjectSummary, type ServiceStatus, type TurnEvent,
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
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

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

  // Watch the files change while the model works.
  //
  // The model writes to disk as it goes, so the information was always there —
  // the panel simply was not looking until the whole turn finished. Several
  // minutes of a static "Working…" with no way to tell alive from stalled is
  // not something anybody should have to sit through.
  useEffect(() => {
    if (!busy || !open) return;
    const tick = () => {
      listFiles(open.id)
        .then((r) => setFiles(r.files))
        .catch(() => {});
    };
    const t = setInterval(tick, 900);
    return () => clearInterval(t);
  }, [busy, open]);

  // How long the current step has been going. Not a progress bar, because we
  // genuinely do not know how long it will take, and a bar that lies is worse
  // than a clock that does not.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Put the cursor in the box the moment a project opens. Somebody who has just
  // opened a build should be able to start typing, not go looking for where.
  useEffect(() => {
    if (open && !busy) draftRef.current?.focus();
  }, [open, busy]);

  const start = async (name: string) => {
    const who = account || (await pointsAccount());
    const p = await createProject(who, name);
    setOpen(p);
    setFiles([]);
    setCheck(null);
    // Spend is per open project. Left over, it would show the last project's
    // total against this one, which is a number about money being wrong.
    setSpend(null);
    setLines([
      {
        kind: "ai",
        text: "Ready. Type what you want the app to do in the box at the bottom, and press Send.",
      },
    ]);
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
        : [
            {
              kind: "ai" as const,
              text: "Nothing said yet. Type what you want the app to do in the box at the bottom.",
            },
          ],
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
      setLines((l) => [
        ...l,
        { kind: "err", text: "The App Builder is not set up on this wallet yet, so nothing can be built." },
      ]);
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

  // The Anthropic key belongs to whoever runs this wallet, set once in the gear
  // menu under AI. A user never sees it and never supplies one — they pay in
  // points instead, which is the whole arrangement. An earlier version asked the
  // person at the keyboard for a key here, which made every user do an
  // operator's job and would have had anyone who complied paying Anthropic
  // directly AND being charged points for the same work.
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

      {needsKey && <NotSetUp />}

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
              {busy && (
                <div className="bd-msg bd-msg-tool bd-working">
                  <span className="bd-pulse" aria-hidden="true" />
                  Working… {formatElapsed(elapsed)}
                </div>
              )}
            </div>
            {needsKey ? (
              <div className="bd-blocked">
                <p className="bd-note bd-bad">
                  Nothing can be built until this wallet has an AI key. Your
                  points are safe and your apps are saved — this is a one-time
                  setup, and it is not something you buy.
                </p>
                <button
                  type="button"
                  className="wl-btn wl-btn-primary"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("dd69:openadmin", { detail: "ai" }))
                  }
                >
                  Open AI settings
                </button>
              </div>
            ) : (
              <div className="bd-compose">
                <label className="bd-compose-label" htmlFor="bd-draft">
                  What should it do?
                </label>
                <div className="bd-compose-row">
                  <textarea
                    id="bd-draft"
                    ref={draftRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter makes a new line. That is what
                      // people expect from a chat box, and the old Cmd+Enter was
                      // a secret.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="e.g. A dice game where I bet DIVI against the house"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="wl-btn wl-btn-primary"
                    disabled={busy || !draft.trim()}
                    onClick={send}
                  >
                    Send
                  </button>
                </div>
                <p className="bd-compose-hint">Enter to send · Shift+Enter for a new line</p>
              </div>
            )}
          </div>

          <div className="bd-files">
            <h4>Files</h4>
            {files.length === 0 ? (
              <p className="bd-empty">Nothing written yet.</p>
            ) : (
              files.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  onOpen={() => void readFile(open.id, f.path).then(setViewing).catch(() => {})}
                />
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

/**
 * One file in the list, with its size counting to whatever it just became.
 *
 * The count is not decoration. A file quietly changing from one number to
 * another says nothing; a number visibly moving says the thing is alive, which
 * during a silent multi-minute build is the only signal there is.
 */
function FileRow({ file, onOpen }: { file: BuilderFile; onOpen: () => void }) {
  const [shown, setShown] = useState(file.bytes);
  const [changed, setChanged] = useState(false);
  const from = useRef(file.bytes);

  useEffect(() => {
    const start = from.current;
    const end = file.bytes;
    if (start === end) return;
    from.current = end;

    setChanged(true);
    const stopFlash = setTimeout(() => setChanged(false), 700);

    // Somebody who has asked not to have things move gets the new number
    // straight away rather than a flicker.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(end);
      return () => clearTimeout(stopFlash);
    }

    const DURATION = 450;
    const began = performance.now();
    let frame = 0;
    const step = () => {
      const through = Math.min(1, (performance.now() - began) / DURATION);
      // Ease out, so it arrives rather than stopping dead.
      const eased = 1 - (1 - through) ** 3;
      setShown(Math.round(start + (end - start) * eased));
      if (through < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      clearTimeout(stopFlash);
      cancelAnimationFrame(frame);
    };
  }, [file.bytes]);

  return (
    <button type="button" className={`bd-file${changed ? " bd-file-changed" : ""}`} onClick={onOpen}>
      <span className="bd-file-name">{file.path}</span>
      <span className="bd-file-size">{formatSize(shown)}</span>
    </button>
  );
}

/** Bytes are meaningless to read. Scale to whatever unit says the most. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
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

/**
 * Shown when no model key is configured on this wallet.
 *
 * Deliberately NOT a place to enter one. This is the operator's job, done once
 * in the gear menu, and putting a key box in front of a user would invite them
 * to pay Anthropic themselves on top of the points they are already spending.
 */
function NotSetUp() {
  return (
    <div className="bd-offline bd-keybox">
      <h3>The App Builder is not switched on yet</h3>
      <p className="bd-note">
        Whoever runs this wallet needs to add an AI key once, in the gear menu
        under AI. Until then nothing can be built. Everything else here works,
        and any apps you have already made are listed below.
      </p>
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
  const [svc, setSvc] = useState<ServiceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Ask the wallet what happened to the service it is supposed to have started.
  // Without this the panel could only say "not switched on", which tells you
  // nothing and leaves you with nothing to do about it.
  useEffect(() => {
    serviceStatus().then(setSvc).catch(() => setSvc(null));
  }, []);

  const tryAgain = async () => {
    setBusy(true);
    try {
      setSvc(await restartService());
      // Give it a moment to bind its port before looking for it.
      setTimeout(onRetry, 1200);
    } catch {
      /* the status line already says what it can */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bd">
      <div className="bd-offline">
        <h3>App Builder is starting up</h3>
        {svc?.running ? (
          <p className="bd-note">
            The service is running but has not answered yet. Give it a second and
            press Try again. Nothing is lost either way — your saved apps are on
            disk.
          </p>
        ) : svc?.trouble ? (
          <>
            <p className="bd-note bd-bad">{svc.trouble}</p>
            {/nodejs|Node is not installed/i.test(svc.trouble) && (
              <p className="bd-note bd-note-gap">
                Node is a free tool the builder runs on. Installing it from
                nodejs.org and reopening the wallet is all that is needed.
              </p>
            )}
          </>
        ) : (
          <p className="bd-note">
            The wallet starts this for you when it opens. It is not answering
            yet. Nothing is broken and nothing is lost — your saved apps are on
            disk and will be here when it comes back.
          </p>
        )}

        <div className="bd-bar bd-bar-plain">
          <button type="button" className="wl-btn wl-btn-primary" disabled={busy} onClick={() => void tryAgain()}>
            {busy ? "Starting…" : "Try again"}
          </button>
        </div>

        {(error || svc) && (
          <details className="bd-details">
            <summary>Technical detail</summary>
            {error && <p className="bd-note bd-note-gap">{error}</p>}
            {svc && <p className="bd-note">Its output is written to {svc.log}</p>}
            <UrlBox onRetry={onRetry} />
          </details>
        )}
      </div>
    </div>
  );
}

/** Only for the rare case of pointing the wallet at a service somewhere else. */
function UrlBox({ onRetry }: { onRetry: () => void }) {
  const [url, setUrl] = useState(builderUrl());
  return (
    <div className="bd-bar bd-bar-plain">
      <input
        className="wl-input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        spellCheck={false}
        aria-label="Builder service address"
      />
      <button type="button" className="wl-btn" onClick={() => { setBuilderUrl(url); onRetry(); }}>
        Use this address
      </button>
    </div>
  );
}
