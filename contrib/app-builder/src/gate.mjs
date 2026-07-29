// Checking what the model wrote, before it can run or be published.
//
// An honest statement of strength, because this is the kind of code people
// over-trust: this reads the source with patterns. It is not a proof, and a
// determined author who knows these checks exist can write around some of them.
//
// It is still worth having, for two reasons that do not depend on it being
// perfect:
//
//   1. Everything it catches is caught before a user ever runs the app, and most
//      of what it catches is a mistake rather than an attack.
//   2. What actually contains a hostile app is the sandbox: no access to the
//      wallet, no network unless declared, and money only ever moving through a
//      confirmation the app cannot draw or click. This layer reduces how often
//      that last line of defence is the only one doing work.
//
// Anything found here at publish time goes to a human. That is deliberate: the
// point is to make review cheap and focused, not to replace it.

export const SEVERITY = { FAIL: "fail", WARN: "warn" };

/**
 * Patterns applied to script content.
 *
 * `fail` stops a build being published. `warn` is surfaced to the reviewer and
 * to the developer but does not stop anything.
 */
export const CODE_RULES = [
  { id: "eval", severity: SEVERITY.FAIL, why: "runs code built at runtime, which cannot be reviewed",
    re: /\beval\s*\(|new\s+Function\s*\(/ },
  { id: "dynamic-import", severity: SEVERITY.FAIL, why: "loads code that is not part of the reviewed bundle",
    re: /\bimport\s*\(/ },
  { id: "reach-wallet", severity: SEVERITY.FAIL, why: "tries to reach the wallet directly instead of asking",
    re: /__TAURI__|window\.parent\s*\.\s*(?!postMessage)[A-Za-z_$]|\bparent\s*\.\s*document\b|\btop\s*\.\s*document\b/ },
  { id: "remote-script", severity: SEVERITY.FAIL, why: "pulls a script from the internet at runtime",
    re: /<script[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i },
  { id: "absolute-url", severity: SEVERITY.WARN, why: "refers to something outside the app",
    re: /["'`](https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i },
  { id: "network-call", severity: SEVERITY.WARN, why: "makes a network request",
    re: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource\s*\(|navigator\.sendBeacon/ },
  { id: "inline-handler", severity: SEVERITY.WARN, why: "uses an inline event attribute rather than a listener",
    re: /\son(click|load|error|mouseover|submit|focus)\s*=\s*["']/i },
  { id: "obfuscated", severity: SEVERITY.FAIL, why: "hides what it does behind encoding",
    re: /\batob\s*\(|String\.fromCharCode\s*\(\s*(\d+\s*,\s*){8,}|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){10,}/i },
  { id: "long-encoded-blob", severity: SEVERITY.WARN, why: "contains a long unexplained encoded run",
    re: /["'`][A-Za-z0-9+/]{300,}={0,2}["'`]/ },
  { id: "asks-for-secrets", severity: SEVERITY.FAIL, why: "asks the user for keys or a seed phrase",
    re: /\b(private key|seed phrase|mnemonic|recovery phrase|wallet password|passphrase)\b/i },
  { id: "storage-probe", severity: SEVERITY.FAIL, why: "pokes at the wallet's own stored data",
    re: /localStorage\s*\.\s*(getItem|removeItem)\s*\(\s*["'`]dd69\./ },
];

/** Methods an app may call, and the permission each one needs. */
const METHOD_PERMISSION = {
  "balance.read": "balance.read",
  "addresses.read": "addresses.read",
  "history.read": "history.read",
  "staking.read": "staking.read",
  "collectibles.read": "collectibles.read",
  "tokens.read": "tokens.read",
  "network.read": "network.read",
  "chain.read": "chain.read",
  storage: "storage",
  "payment.request": "payment.request",
  network: "network",
  "clipboard.write": "clipboard.write",
  notify: "notify",
};

const SCRIPTY = new Set(["js", "html"]);

function ext(p) {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i + 1).toLowerCase();
}

/**
 * Which wallet methods does this source actually call?
 *
 * Matches both the direct form and the helpers the SDK exposes, so an app using
 * `divi.balance()` is recognised as using `balance.read`.
 */
export function methodsUsed(source) {
  const found = new Set();
  for (const m of Object.keys(METHOD_PERMISSION)) {
    if (new RegExp(`["'\`]${m.replace(".", "\\.")}["'\`]`).test(source)) found.add(m);
  }
  const helpers = [
    [/\bdivi\s*\.\s*balance\s*\(/, "balance.read"],
    [/\bdivi\s*\.\s*addresses\s*\(/, "addresses.read"],
    [/\bdivi\s*\.\s*history\s*\(/, "history.read"],
    [/\bdivi\s*\.\s*staking\s*\(/, "staking.read"],
    [/\bdivi\s*\.\s*chain\s*\(/, "chain.read"],
    [/\bdivi\s*\.\s*network\s*\(/, "network.read"],
    [/\bdivi\s*\.\s*storage\s*\./, "storage"],
    [/\bdivi\s*\.\s*requestPayment\s*\(/, "payment.request"],
    [/\bdivi\s*\.\s*copy\s*\(/, "clipboard.write"],
    [/\bdivi\s*\.\s*notify\s*\(/, "notify"],
  ];
  for (const [re, method] of helpers) if (re.test(source)) found.add(method);
  return [...found];
}

/**
 * Check a whole app.
 *
 * @param {{files: Array<{path: string, text?: string}>, manifest?: any}} app
 * @returns {{ok: boolean, findings: Array, methods: string[]}}
 */
export function checkApp(app, { rules = CODE_RULES } = {}) {
  const findings = [];
  const files = app?.files ?? [];
  const manifest = app?.manifest;

  const add = (severity, id, why, where) => findings.push({ severity, id, why, where });

  if (!files.some((f) => f.path === "index.html")) {
    add(SEVERITY.FAIL, "no-entry", "an app needs an index.html to open", "app");
  }
  if (!manifest) {
    add(SEVERITY.FAIL, "no-manifest", "an app needs a manifest describing what it is", "app");
  }

  const allMethods = new Set();

  for (const f of files) {
    if (!SCRIPTY.has(ext(f.path))) continue;
    const text = f.text ?? "";
    for (const rule of rules) {
      let hit = false;
      try {
        hit = rule.re.test(text);
      } catch {
        hit = false; // a bad admin-entered pattern must not break the gate
      }
      if (hit) add(rule.severity, rule.id, rule.why, f.path);
    }
    for (const m of methodsUsed(text)) allMethods.add(m);
  }

  // Using something the app never declared is a hard stop: the wallet would
  // refuse it at runtime anyway, so shipping it is a broken app at best and a
  // dishonest permission screen at worst.
  const declared = new Set(manifest?.permissions ?? []);
  for (const m of allMethods) {
    const needed = METHOD_PERMISSION[m];
    if (needed && !declared.has(needed)) {
      add(SEVERITY.FAIL, "undeclared-permission",
        `uses "${needed}" but does not ask for it in the manifest`, "manifest");
    }
  }

  // The reverse is only a warning: asking for more than you use is untidy rather
  // than dangerous, but it does make the permission screen scarier than it needs
  // to be, so it is worth telling the developer.
  for (const p of declared) {
    if (!allMethods.has(p)) {
      add(SEVERITY.WARN, "unused-permission",
        `asks for "${p}" but never uses it`, "manifest");
    }
  }

  // A network permission with no hosts, or hosts with no permission, is a
  // contradiction the wallet cannot honour.
  const hosts = manifest?.network ?? [];
  if (declared.has("network") && hosts.length === 0) {
    add(SEVERITY.WARN, "network-without-hosts",
      "asks for internet access but lists no sites", "manifest");
  }

  const ok = !findings.some((f) => f.severity === SEVERITY.FAIL);
  return { ok, findings, methods: [...allMethods].sort() };
}

/** One line a person can read, for the chat and the review queue. */
export function summarise(result) {
  const fails = result.findings.filter((f) => f.severity === SEVERITY.FAIL);
  const warns = result.findings.filter((f) => f.severity === SEVERITY.WARN);
  if (result.ok && warns.length === 0) return "Checked: nothing to flag.";
  if (result.ok) return `Checked: ${warns.length} thing${warns.length === 1 ? "" : "s"} worth a look, nothing blocking.`;
  return `Not publishable yet: ${fails.length} problem${fails.length === 1 ? "" : "s"} must be fixed.`;
}
