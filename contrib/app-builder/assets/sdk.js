// The Divi Community Apps SDK.
//
// An app runs in a sandboxed frame with an opaque origin, so the wallet cannot
// reach in and inject anything. That means the app carries this shim itself.
// It is deliberately tiny and has no dependencies: everything it does is send a
// message to the host and wait for the matching reply.
//
// Protocol (see docs/COMMUNITY-APPS-MANIFEST.md section 4):
//   out: { proto: "divi.app.v1", id, method, params }
//   in:  { proto: "divi.app.v1", id, ok, result | error }

(function () {
  const PROTO = "divi.app.v1";
  const pending = new Map();
  let nextId = 1;

  window.addEventListener("message", (ev) => {
    // Only the host can be the parent of this frame, so the parent window is the
    // only sender worth listening to.
    if (ev.source !== window.parent) return;
    const d = ev.data;
    if (!d || d.proto !== PROTO || typeof d.id !== "number") return;
    const entry = pending.get(d.id);
    if (!entry) return;
    pending.delete(d.id);
    clearTimeout(entry.timer);
    if (d.ok) entry.resolve(d.result);
    else entry.reject(new Error(d.error || "refused"));
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      // A host that never answers must not leave the caller hanging for ever.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("the wallet did not answer"));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ proto: PROTO, id, method, params }, "*");
    });
  }

  /**
   * Wear the wallet's look, automatically.
   *
   * A sandboxed frame does not inherit CSS custom properties from the page
   * around it, so every --colour and --font the wallet defines is simply absent
   * in here. Without this, an app styled exactly as instructed comes out with
   * no colours at all. Asking the host for them and setting them locally is
   * what makes "use the wallet's variables" true rather than merely good advice.
   *
   * Needs no permission: it is public styling information, and an app should
   * not have to ask to look right.
   */
  function wearTheWalletsLook() {
    request("theme.read")
      .then((r) => {
        const root = document.documentElement;
        for (const [name, value] of Object.entries(r.vars || {})) {
          root.style.setProperty(name, value);
        }
        root.setAttribute("data-divi-themed", "true");
      })
      .catch(() => {
        // Styling is not worth breaking an app over. The stylesheet's own
        // fallbacks take over and it still runs.
      });
  }

  /**
   * Tell the wallet when this app breaks.
   *
   * Nobody outside a sandboxed frame can see an error inside it, so without
   * this an app that crashes on its first line looks identical to one that is
   * simply slow — which is exactly the state somebody sat looking at while
   * wondering why their game would not start.
   */
  function reportCrashes() {
    // The same failure inside an animation loop happens sixty times a second.
    // Reporting each one would drown the wallet and tell nobody anything the
    // first one did not.
    const alreadySaid = new Set();
    const say = (message, where) => {
      const key = message + "@" + where;
      if (alreadySaid.has(key) || alreadySaid.size > 20) return;
      alreadySaid.add(key);
      request("app.error", { message: String(message), where }).catch(() => {});
    };
    window.addEventListener("error", (e) => {
      say(e.message || "script error", e.filename ? `${e.filename.split("/").pop()}:${e.lineno}` : "");
    });
    window.addEventListener("unhandledrejection", (e) => {
      say(e.reason && e.reason.message ? e.reason.message : String(e.reason), "a promise");
    });
  }

  window.divi = {
    request,
    balance: () => request("balance.read"),
    addresses: () => request("addresses.read"),
    history: (count, from) => request("history.read", { count, from }),
    staking: () => request("staking.read"),
    chain: (blocks) => request("chain.read", { blocks }),
    network: () => request("network.read"),
    storage: {
      get: (key) => request("storage", { op: "get", key }).then((r) => r.value),
      set: (key, value) => request("storage", { op: "set", key, value }),
      remove: (key) => request("storage", { op: "remove", key }),
      keys: () => request("storage", { op: "keys" }).then((r) => r.keys),
      clear: () => request("storage", { op: "clear" }),
    },
    // ---- Public facts the wallet already knows, so an app never has to ----
    price: () => request("price.read"),
    names: {
      resolve: (name) => request("names.read", { op: "resolve", name }).then((r) => r.address),
      reverse: (address) => request("names.read", { op: "reverse", address }).then((r) => r.name),
      market: () => request("names.read", { op: "market" }).then((r) => r.listings),
      quote: (name) => request("names.read", { op: "quote", name }),
    },
    lookup: {
      validate: (address) => request("lookup.read", { op: "validate", address }).then((r) => r.valid),
      balance: (address) => request("lookup.read", { op: "balance", address }),
      qr: (address) => request("lookup.read", { op: "qr", address }).then((r) => r.image),
      payment: (txid) => request("lookup.read", { op: "payment", txid }),
    },
    mempool: () => request("mempool.read"),
    verifyProof: (txid, hash) => request("poe.verify", { txid, hash }),

    requestPayment: (amount, reason) =>
      request("payment.request", { amount, reason }).then((r) => r.paid),
    copy: (text) => request("clipboard.write", { text }),
    notify: (text) => request("notify", { text }),
    /** The wallet's colours and fonts, already applied for you. */
    theme: () => request("theme.read").then((r) => r.vars),
  };

  wearTheWalletsLook();
  reportCrashes();
})();
