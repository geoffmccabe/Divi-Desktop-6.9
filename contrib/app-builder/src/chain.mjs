// Checking that a DIVI payment really happened.
//
// The point of this file is that we do NOT take the buyer's word for it. The
// wallet tells us a transaction id; we go and look at the chain ourselves
// through the Divi node, and credit points only if the node agrees.
//
// If the node cannot be reached, nothing is credited and the order stays open.
// Failing closed here costs a buyer a short wait. Failing open would let anyone
// mint points by inventing a transaction id.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export class ChainError extends Error {}

/** Confirmations before points appear. One block is thin for money. */
export const MIN_CONFIRMATIONS = 2;

/** Where DD69 keeps divi.conf, matching crates/supervisor/src/config.rs. */
export function defaultDatadir() {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library/Application Support/DIVI");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? "", "DIVI");
  return path.join(home, ".divi");
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
export async function readRpcConfig(datadir = defaultDatadir()) {
  let text;
  try {
    text = await fs.readFile(path.join(datadir, "divi.conf"), "utf8");
  } catch {
    return null;
  }
  const conf = parseConf(text);
  if (!conf.rpcuser || !conf.rpcpassword) return null;
  return {
    user: conf.rpcuser,
    pass: conf.rpcpassword,
    port: Number(conf.rpcport || 51473),
    host: "127.0.0.1",
  };
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
