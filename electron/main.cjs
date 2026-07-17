// Divi Desktop 6.9 — Electron main process. Bundles Chromium (renders reliably
// where the OS webview did not). It owns the window and runs the Rust engine
// (the `dd69` binary) as a child process; the renderer never touches the node
// directly.
const { app, BrowserWindow, ipcMain } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const LOG = path.join(app.getPath("temp"), "dd69-electron.log");
const log = (m) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);

// Locate the Rust engine binary (release preferred, then debug).
function dd69Path() {
  for (const p of ["release", "debug"]) {
    const candidate = path.join(ROOT, "target", p, "dd69");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Run `dd69 status --json` and return the parsed object.
function nodeStatus() {
  return new Promise((resolve) => {
    const bin = dd69Path();
    if (!bin) {
      resolve({ running: false, phase: "stopped", headline: "Engine binary not found (build it first).", blocks: null, peers: null });
      return;
    }
    execFile(bin, ["status", "--json"], { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        log(`dd69 err: code=${err.code} killed=${err.killed} stderr=${JSON.stringify(stderr)}`);
        resolve({ running: false, phase: "starting", headline: "Waiting for the node…", blocks: null, peers: null });
        return;
      }
      log(`dd69 ok: ${stdout.trim()}`);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ running: false, phase: "starting", headline: "Waiting for the node…", blocks: null, peers: null });
      }
    });
  });
}

ipcMain.handle("node-status", () => nodeStatus());

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#191622",
    title: "Divi Desktop 6.9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Surface renderer problems to a file we can read (no dev-tools needed).
  win.webContents.on("console-message", (_e, level, message) => log(`console[${level}]: ${message}`));
  win.webContents.on("did-fail-load", (_e, code, desc) => log(`did-fail-load ${code} ${desc}`));
  win.webContents.on("render-process-gone", (_e, d) => log(`render-process-gone ${JSON.stringify(d)}`));

  win.loadFile(path.join(ROOT, "ui", "dist", "index.html"));

  // Dev aid: self-screenshot a few seconds after load so rendering can be
  // verified from a file instead of the screen. Harmless; remove later.
  win.webContents.on("did-finish-load", () => {
    let n = 0;
    const shoot = async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(app.getPath("temp"), "dd69-shot.png"), img.toPNG());
        log(`captured screenshot ${++n}`);
      } catch (e) {
        log("capture failed: " + e);
      }
    };
    // Capture a few times so a frame with resolved live data is caught.
    [8000, 16000, 24000].forEach((t) => setTimeout(shoot, t));
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
