import { test } from "node:test";
import assert from "node:assert/strict";

import { checkApp, methodsUsed, summarise, SEVERITY } from "../src/gate.mjs";

const manifest = (permissions = [], network = []) => ({
  schema: 1,
  id: "com.example.test",
  name: "Test",
  version: "1.0.0",
  author: { name: "A", address: "DNx1cSCMXg73Efg1NFFYuoRvRg5ThmNfHF" },
  description: "d",
  permissions,
  network,
  media: { thumbnail: "thumb.webp" },
  price: { model: "free" },
});

const app = (files, m = manifest()) => ({ files, manifest: m });

function ids(result, severity) {
  return result.findings.filter((f) => !severity || f.severity === severity).map((f) => f.id);
}

test("a plain honest app passes cleanly", () => {
  const r = checkApp(app(
    [
      { path: "index.html", text: "<h1>Hi</h1><script src='app.js'></script>" },
      { path: "app.js", text: "document.querySelector('h1').textContent = 'Hello';" },
    ],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.findings.length, 0);
  assert.match(summarise(r), /nothing to flag/);
});

test("code built at runtime is refused", () => {
  for (const bad of ["eval('x')", "new Function('return 1')()", "import('./x.js')"]) {
    const r = checkApp(app([
      { path: "index.html", text: "<h1>x</h1>" },
      { path: "app.js", text: bad },
    ]));
    assert.equal(r.ok, false, `${bad} was allowed`);
  }
});

test("reaching for the wallet directly is refused", () => {
  const r = checkApp(app([
    { path: "index.html", text: "<h1>x</h1>" },
    { path: "app.js", text: "const t = window.parent.__TAURI__; t.core.invoke('wallet_balance');" },
  ]));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("reach-wallet"));
});

test("a script pulled off the internet is refused", () => {
  const r = checkApp(app([
    { path: "index.html", text: "<script src='https://cdn.example.com/x.js'></script>" },
  ]));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("remote-script"));
});

test("asking the user for a seed phrase is refused", () => {
  const r = checkApp(app([
    { path: "index.html", text: "<label>Enter your seed phrase to continue</label>" },
  ]));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("asks-for-secrets"));
});

test("poking at the wallet's own stored data is refused", () => {
  const r = checkApp(app([
    { path: "index.html", text: "<h1>x</h1>" },
    { path: "app.js", text: "localStorage.getItem('dd69.contacts')" },
  ]));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("storage-probe"));
});

test("hiding behaviour behind encoding is refused", () => {
  const r = checkApp(app([
    { path: "index.html", text: "<h1>x</h1>" },
    { path: "app.js", text: "atob('c2VuZCBhbGwgdGhlIGNvaW5z')" },
  ]));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("obfuscated"));
});

test("using a permission it never asked for is refused", () => {
  const r = checkApp(app(
    [
      { path: "index.html", text: "<h1>x</h1>" },
      { path: "app.js", text: "divi.requestPayment(5, 'unlock')" },
    ],
    manifest([]), // asks for nothing
  ));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("undeclared-permission"));
});

test("declaring what it actually uses passes", () => {
  const r = checkApp(app(
    [
      { path: "index.html", text: "<script src=sdk.js></script>" },
      // The SDK has to be present for any of this to work at runtime, so an app
      // that talks to the wallet must carry it.
      { path: "sdk.js", text: "// the wallet sdk" },
      { path: "app.js", text: "divi.balance().then(b => console.log(b.spendable))" },
    ],
    manifest(["balance.read"]),
  ));
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.deepEqual(r.methods, ["balance.read"]);
});

test("using the wallet without including its SDK is caught", () => {
  // Every call would be undefined at runtime. Better to say so here than let
  // somebody find out after publishing.
  const r = checkApp(app(
    [
      { path: "index.html", text: "<h1>x</h1>" },
      { path: "app.js", text: "divi.balance()" },
    ],
    manifest(["balance.read"]),
  ));
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.id === "missing-sdk"));
});

test("asking for more than it uses is a warning, not a block", () => {
  const r = checkApp(app(
    [{ path: "index.html", text: "<h1>x</h1>" }],
    manifest(["balance.read", "history.read"]),
  ));
  assert.equal(r.ok, true);
  assert.ok(ids(r, SEVERITY.WARN).includes("unused-permission"));
});

test("network calls and outside links are flagged but not blocked", () => {
  const r = checkApp(app(
    [
      { path: "index.html", text: "<a href='https://example.com'>docs</a>" },
      { path: "app.js", text: "fetch('https://example.com/data.json')" },
    ],
    manifest(["network"], ["example.com"]),
  ));
  assert.equal(r.ok, true, "these are worth a look, not an automatic refusal");
  assert.ok(ids(r, SEVERITY.WARN).includes("network-call"));
});

test("an app with no way in is refused", () => {
  const r = checkApp(app([{ path: "app.js", text: "console.log(1)" }]));
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("no-entry"));
});

test("an app with no manifest is refused", () => {
  const r = checkApp({ files: [{ path: "index.html", text: "<h1>x</h1>" }] });
  assert.equal(r.ok, false);
  assert.ok(ids(r, SEVERITY.FAIL).includes("no-manifest"));
});

test("both direct calls and the shorthand helpers are recognised", () => {
  assert.deepEqual(methodsUsed("divi.request('history.read')"), ["history.read"]);
  assert.deepEqual(methodsUsed("divi.history(10, 0)"), ["history.read"]);
  assert.deepEqual(methodsUsed("divi.storage.set('a', 1)"), ["storage"]);
});

test("images and other assets are not scanned as code", () => {
  // An svg containing the word eval must not fail the app.
  const r = checkApp(app([
    { path: "index.html", text: "<h1>x</h1>" },
    { path: "art.svg", text: "<svg><desc>eval</desc></svg>" },
  ]));
  assert.equal(r.ok, true);
});

test("a broken rule is ignored rather than breaking the check", () => {
  const r = checkApp(
    app([{ path: "index.html", text: "<h1>x</h1>" }]),
    { rules: [{ id: "broken", severity: SEVERITY.FAIL, why: "bad", re: { test() { throw new Error("boom"); } } }] },
  );
  assert.equal(r.ok, true);
});

test("the wallet's own SDK is not read as if it were the app's code", async () => {
  // It NAMES every wallet method, because it defines them. Scanning it made
  // every app look like it used everything, so nothing could ever be published.
  const { readSdk } = await import("../src/scaffold.mjs");
  const sdk = await readSdk();
  const r = checkApp(
    {
      files: [
        { path: "index.html", text: "<script src=sdk.js></script>" },
        { path: "sdk.js", text: sdk },
      ],
      manifest: { permissions: [] },
    },
    { sdkText: sdk },
  );
  assert.deepEqual(r.methods, [], "an app that calls nothing uses nothing");
  assert.ok(!r.findings.some((f) => f.id === "undeclared-permission"));
});

test("a modified SDK is a hard stop, not a file scanned more carefully", async () => {
  // This is where a hostile app would put code to intercept what the wallet
  // sends back, so it cannot be waved through.
  const { readSdk } = await import("../src/scaffold.mjs");
  const sdk = await readSdk();
  const r = checkApp(
    {
      files: [
        { path: "index.html", text: "<script src=sdk.js></script>" },
        { path: "sdk.js", text: sdk + "\n// quietly added\n" },
      ],
      manifest: { permissions: [] },
    },
    { sdkText: sdk },
  );
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.id === "modified-sdk" && f.severity === "fail"));
});

test("what the app itself calls is still counted", async () => {
  const { readSdk } = await import("../src/scaffold.mjs");
  const sdk = await readSdk();
  const r = checkApp(
    {
      files: [
        { path: "index.html", text: "<script src=sdk.js></script><script src=app.js></script>" },
        { path: "sdk.js", text: sdk },
        { path: "app.js", text: "divi.balance().then(b => console.log(b));" },
      ],
      manifest: { permissions: [] },
    },
    { sdkText: sdk },
  );
  assert.deepEqual(r.methods, ["balance.read"]);
  assert.ok(r.findings.some((f) => f.id === "undeclared-permission"));
});

test("an example in a comment is not a call", async () => {
  // The starter file explains what is available with example lines. Reading
  // those as calls made every new app look like it used four permissions it had
  // not declared, so nothing could be published.
  const app = `// await divi.balance() needs "balance.read"
// await divi.notify("hi") needs "notify"
async function main() {}`;
  assert.deepEqual(methodsUsed(app), []);
});

test("stripping comments does not swallow code after a url", () => {
  // A naive stripper cuts at the // inside "https://", taking real code with it
  // and hiding whatever came after from the checks.
  const src = `const u = "https://example.com/x"; divi.balance();`;
  assert.deepEqual(methodsUsed(src), ["balance.read"]);
});

test("the security rules still read the whole file, comments and all", () => {
  // Usage detection may ignore comments; the safety rules must not start
  // trusting a stripper to decide what is worth looking at.
  const r = checkApp({
    files: [{ path: "app.js", text: `/* explanation */ eval("1+1");` }],
    manifest: { permissions: [] },
  });
  assert.ok(r.findings.some((f) => f.id === "eval" && f.severity === "fail"));
});
