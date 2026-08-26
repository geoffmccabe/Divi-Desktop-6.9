// What an app can actually ask the wallet to do.
//
// This is sent with every build request, and it is deliberately a list of what
// WORKS TODAY, not a wish list. A model told about a capability that does not
// exist will cheerfully write code that calls it, and the developer gets an app
// that fails at runtime having paid to have it built. So anything not wired all
// the way through to a real answer is left out of here entirely.
//
// Each entry is the helper, the permission it needs, and what comes back. The
// permission names match ui/src/apps/permissions.ts, and the broker refuses
// anything not in that table, so this list cannot quietly grow past what the
// wallet will honour.

export const CAPABILITIES = [
  {
    call: "await divi.balance()",
    permission: "balance.read",
    returns: "{ spendable, staking, pending, immature } in DIVI",
    note: "Totals only. Never an address, never a key.",
  },
  {
    call: "await divi.addresses()",
    permission: "addresses.read",
    returns: "[{ address, receives, sends }]",
    note: "The person's own receiving addresses.",
  },
  {
    call: "await divi.history(count, from)",
    permission: "history.read",
    returns: "[{ txid, amount, kind, time, confirmations }]",
    note: "count is capped at 200. Newest first.",
  },
  {
    call: "await divi.staking()",
    permission: "staking.read",
    returns: "{ wallets, lottery }",
    note: "Whether staking is on, per-address stake counts, lottery timing and past wins.",
  },
  {
    call: "await divi.chain(blocks)",
    permission: "chain.read",
    returns: "{ status: { phase, blocks, peers, reachable }, blocks: [...] }",
    note: "blocks is capped at 20. `reachable: false` means the node is not answering — say so rather than showing zeroes.",
  },
  {
    call: "await divi.network()",
    permission: "network.read",
    returns: "{ peers: [{ inbound, height }] }",
    note: "The same peer information the wallet already shows publicly.",
  },
  {
    call: "await divi.price()",
    permission: "price.read",
    returns: "{ prices: { usd: 0.0013, ... }, source, available }",
    note: "The currencies this wallet is set up for. `available: false` means there is no price right now — show that rather than a zero.",
  },
  {
    call: "await divi.names.resolve(name) / .reverse(address) / .market() / .quote(name)",
    permission: "names.read",
    returns: "an address, a name, the names for sale, or what a name would cost",
    note: "Divi Names. resolve turns \"geoff.divi\" into an address; reverse does the opposite. Both return null when there is no match, which is normal.",
  },
  {
    call: "await divi.lookup.validate(a) / .balance(a) / .qr(a) / .payment(txid)",
    permission: "lookup.read",
    returns: "true or false, a public balance, a QR image, or { confirmations }",
    note: "Works on ANY public address, not just the user's. Use validate before showing an address anywhere. payment() is how you watch for a payment you asked for to confirm.",
  },
  {
    call: "await divi.mempool()",
    permission: "mempool.read",
    returns: "{ tip, waiting }",
    note: "How many transactions are queued network-wide, and the current block height.",
  },
  {
    call: "await divi.verifyProof(txid, hash)",
    permission: "poe.verify",
    returns: "the proof, if that fingerprint really was put on the chain",
    note: "Checking only. An app cannot stamp anything: that spends money, so only the wallet does it.",
  },
  {
    call: "await divi.storage.get(key) / .set(key, value) / .remove(key) / .keys() / .clear()",
    permission: "storage",
    returns: "the stored value, or a confirmation",
    note: "Private to this app. Keys are up to 64 characters of letters, numbers, dot, dash, underscore. 64KB a value, 512KB and 200 keys in total. Assume it can be cleared.",
  },
  {
    call: "await divi.requestPayment(amount, reason)",
    permission: "payment.request",
    returns: "true if the person approved, false if they refused",
    note: "You can ASK. The wallet draws the confirmation, outside your frame, and only the person can approve it. You cannot draw it, style it or click it.",
  },
  {
    call: "await divi.copy(text)",
    permission: "clipboard.write",
    returns: "{ copied: true }",
    note: "Write only; you can never read the clipboard. Copying an address the person did not choose is treated as hostile.",
  },
  {
    call: "await divi.notify(text)",
    permission: "notify",
    returns: "{ shown: true }",
    note: "A short message inside the wallet. Limited in how often it can appear.",
  },
];

/** Things a developer will reach for that are not connected yet. Say so plainly. */
export const NOT_YET = [
  ["divi.tokens()", "Divi Meta Token balances — the token index is not live"],
  ["divi.collectibles()", "Divi Collectibles (NFDs) — the mint and view path is not shipped"],
  ["fetch() to the internet", "brokered network access is not switched on; every app is offline"],
];

export function capabilityBrief() {
  const rows = CAPABILITIES.map(
    (c) => `  ${c.call}\n      needs: ${c.permission}\n      gives: ${c.returns}\n      ${c.note}`,
  ).join("\n\n");
  const missing = NOT_YET.map(([c, why]) => `  ${c} — ${why}`).join("\n");
  return `WHAT THE WALLET CAN DO FOR YOU

Everything below is real and works today. Every call is a promise, and every one
can be refused — handle that.

For any of these to work, the permission must be listed in manifest.json AND the
person must have agreed to it when they opened the app. Ask for the fewest you
need: a long permission list makes people refuse the whole app.

${rows}

NOT AVAILABLE. Do not call these, do not write code around them, and if the
developer asks for one, say plainly that it is not connected yet:
${missing}

There is no internet access of any kind. No fetch, no XMLHttpRequest, no
WebSocket, no script from a CDN. Everything the app needs must be in its own
folder or come from the wallet through the calls above.`;
}
