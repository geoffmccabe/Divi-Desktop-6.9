// Checking that a DIVI payment really happened.
//
// The point of this file is that we do NOT take the buyer's word for it. We ask
// the chain what has been paid to the purchase address, and credit points only
// if the answer is there.
//
// It works by looking up the ADDRESS, not a transaction the buyer hands us.
// That is the stronger way round: each order owes a unique amount, so finding
// that exact amount paid to our address identifies the order on its own. A
// buyer cannot point us at somebody else's payment, and cannot invent one.
// (A transaction id may still be supplied, but only as a hint that makes the
// check happen sooner.)
//
// This needs `addressindex=1`, which both the wallet's own node and the node
// holding the purchase address already run.
//
// If the chain cannot be reached, nothing is credited and the order stays open.
// Failing closed here costs a buyer a short wait. Failing open would let anyone
// mint points from thin air.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export class ChainError extends Error {}

/** Confirmations before points appear. One block is thin for money. */
export const MIN_CONFIRMATIONS = 2;

/**
 * Where to look for divi.conf, in order.
 *
 * DD69 runs its OWN node in its OWN folder, deliberately kept apart from a
 * Divi Desktop 2.0 install so the two cannot fight over the same chain data.
 * So its folder is tried first and the shared one only as a fallback, matching
 * `dd69_datadir()` then `default_datadir()` in
 * crates/supervisor/src/config.rs. Getting this the wrong way round means
 * reading the credentials of a node that is not the one running.
 */
export function datadirCandidates() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library/Application Support/DD69/data"),
      path.join(home, "Library/Application Support/DIVI"),
    ];
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? "";
    return [path.join(appdata, "DD69/data"), path.join(appdata, "DIVI")];
  }
  return [path.join(home, ".local/share/DD69/data"), path.join(home, ".divi")];
}

export function defaultDatadir() {
  return datadirCandidates()[0];
}

export function parseConf(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 0) continue;
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

/**
 * Read the node's RPC details from divi.conf, the same file the wallet uses.
 * Returns null when they are not there, so callers can say so plainly rather
 * than failing with something cryptic.
 */
export async function readRpcConfig(datadir) {
  const dirs = datadir ? [datadir] : datadirCandidates();
  for (const dir of dirs) {
    let text;
    try {
      text = await fs.readFile(path.join(dir, "divi.conf"), "utf8");
    } catch {
      continue;
    }
    const conf = parseConf(text);
    // A conf without credentials belongs to a node we cannot talk to, so keep
    // looking rather than giving up on the whole thing.
    if (!conf.rpcuser || !conf.rpcpassword) continue;
    return {
      datadir: dir,
      user: conf.rpcuser,
      pass: conf.rpcpassword,
      port: Number(conf.rpcport || 51473),
      host: "127.0.0.1",
    };
  }
  return null;
}

export function nodeClient(rpc, fetchImpl = fetch) {
  const url = `http://${rpc.host}:${rpc.port}/`;
  const auth = "Basic " + Buffer.from(`${rpc.user}:${rpc.pass}`).toString("base64");
  return {
    async call(method, params = []) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ jsonrpc: "1.0", id: "dd69-points", method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json().catch(() => null);
      if (body?.error) throw new ChainError(body.error.message ?? "the node refused that request");
      if (!res.ok) throw new ChainError(`the node returned ${res.status}`);
      return body?.result;
    },
  };
}

/**
 * The node that holds the purchase address, reached through its read-only
 * proxy rather than its RPC port.
 *
 * That proxy exists precisely for this: it allows a short list of chain
 * queries and does not carry a single wallet, key, signing or node-control
 * method, so a leaked address for it yields public chain data and nothing more.
 * The node's own RPC port stays bound to its loopback and is never exposed.
 */
export function proxyClient({ url, secret, fetchImpl = fetch }) {
  if (!url) throw new ChainError("no chain proxy url was configured");
  return {
    async call(method, params = []) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { "X-Scan-Secret": secret } : {}),
        },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json().catch(() => null);
      if (body?.error) throw new ChainError(String(body.error.message ?? body.error));
      if (!res.ok) throw new ChainError(`the chain proxy returned ${res.status}`);
      return body?.result;
    },
  };
}

/** DIVI carries 8 decimals on chain, counted in satoshi. */
export function toSatoshis(divi) {
  return Math.round((Number(divi) || 0) * 1e8);
}

/**
 * Every payment the chain has recorded to one address.
 *
 * Returns only money coming IN; the negative deltas are that address spending
 * again, which is none of our business here.
 */
export async function paymentsTo(node, address) {
  const deltas = await node.call("getaddressdeltas", [{ addresses: [address] }]);
  if (!Array.isArray(deltas)) return [];
  return deltas
    .filter((d) => Number(d?.satoshis) > 0)
    .map((d) => ({
      txid: String(d.txid ?? ""),
      satoshis: Number(d.satoshis),
      height: Number(d.height ?? 0),
    }));
}

/**
 * Find the payment that settles an order.
 *
 * Matches the EXACT amount owed, because that amount is unique to the order and
 * is what makes a payment identify itself. A transaction id, if the buyer gave
 * us one, is accepted as an alternative match so an overpayment can still be
 * recognised rather than silently ignored.
 */
export async function findPayment(node, { address, amountDivi, txidHint = null, minConfirmations = MIN_CONFIRMATIONS }) {
  const want = toSatoshis(amountDivi);
  const [payments, tip] = await Promise.all([
    paymentsTo(node, address),
    node.call("getblockcount"),
  ]);

  const hint = String(txidHint ?? "").trim().toLowerCase();
  const match =
    payments.find((p) => p.satoshis === want) ??
    (hint ? payments.find((p) => p.txid.toLowerCase() === hint && p.satoshis >= want) : undefined);

  if (!match) return { found: false, confirmed: false, needs: minConfirmations };

  // A height of zero means it is not in a block yet.
  const confirmations = match.height > 0 ? Number(tip) - match.height + 1 : 0;
  return {
    found: true,
    txid: match.txid,
    paid: match.satoshis / 1e8,
    confirmations,
    confirmed: confirmations >= minConfirmations,
    needs: minConfirmations,
  };
}

/**
 * Does this transaction pay `address` at least `amount`, and is it settled?
 *
 * Deliberately tolerant in one direction only: paying MORE than asked is fine
 * (fees and change make exact amounts awkward), paying less is not.
 */
export async function verifyPayment(node, { txid, address, amount }) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(txid ?? ""))) {
    throw new ChainError("that is not a transaction id");
  }

  let tx;
  try {
    tx = await node.call("gettransaction", [txid]);
  } catch (e) {
    // Not in this wallet: try the chain-wide lookup, which needs txindex.
    try {
      tx = await node.call("getrawtransaction", [txid, 1]);
    } catch {
      throw new ChainError(e.message || "the node has not seen that transaction");
    }
  }
  if (!tx) throw new ChainError("the node has not seen that transaction");

  const confirmations = Number(tx.confirmations ?? 0);
  if (confirmations < 0) {
    throw new ChainError("that transaction conflicts with another and will not confirm");
  }

  const paid = amountPaidTo(tx, address);
  if (paid <= 0) throw new ChainError("that transaction does not pay the purchase address");
  if (paid + 1e-8 < Number(amount)) {
    throw new ChainError(
      `that transaction paid ${paid} DIVI, and this purchase needs ${amount} DIVI`,
    );
  }

  return {
    confirmed: confirmations >= MIN_CONFIRMATIONS,
    confirmations,
    paid,
    needs: MIN_CONFIRMATIONS,
  };
}

/** Total paid to one address by a transaction, in either RPC's shape. */
export function amountPaidTo(tx, address) {
  let total = 0;

  // gettransaction: wallet's own view, with a details list.
  for (const d of tx.details ?? []) {
    if (d.category === "receive" && d.address === address) total += Number(d.amount) || 0;
  }
  if (total > 0) return round8(total);

  // getrawtransaction verbose: raw outputs.
  for (const out of tx.vout ?? []) {
    const addrs = out.scriptPubKey?.addresses ?? (out.scriptPubKey?.address ? [out.scriptPubKey.address] : []);
    if (addrs.includes(address)) total += Number(out.value) || 0;
  }
  return round8(total);
}

function round8(n) {
  return Math.round((Number(n) || 0) * 1e8) / 1e8;
}
