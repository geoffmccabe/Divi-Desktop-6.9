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
    requestPayment: (amount, reason) =>
      request("payment.request", { amount, reason }).then((r) => r.paid),
    copy: (text) => request("clipboard.write", { text }),
    notify: (text) => request("notify", { text }),
  };
})();
