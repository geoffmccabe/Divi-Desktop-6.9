// A local record of bearer codes this wallet has created, so the sender can
// re-copy or reclaim an unredeemed one. The code embeds a key, so this is a
// sensitive store — but for a REVOCABLE bearer the same key already lives in the
// node's wallet, so this file grants nothing the node doesn't already hold. It
// lives only on this machine and is never sent anywhere.

const KEY = "dd69.bearerCodes";

export interface BearerRecord {
  code: string;
  amount: number;
  txid: string;
  memo: string;
  createdAt: number; // ms
}

export function loadBearerCodes(): BearerRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addBearerCode(rec: BearerRecord): void {
  const all = loadBearerCodes();
  all.unshift(rec);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch {
    /* storage unavailable */
  }
}

export function removeBearerCode(txid: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadBearerCodes().filter((r) => r.txid !== txid)));
  } catch {
    /* storage unavailable */
  }
}

// Bearer transactions carry no on-chain marker (they're ordinary payments), so
// the only way to label one in history is to remember the txids WE created or
// redeemed through the app. Sent = a code we made (funding txid, tracked above).
// Received = a code we swept into this wallet (the sweep txid).
const RECEIVED_KEY = "dd69.bearerReceived";

function loadReceived(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECEIVED_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addBearerReceived(txid: string): void {
  if (!txid) return;
  const all = loadReceived();
  if (all.includes(txid)) return;
  all.unshift(txid);
  try {
    localStorage.setItem(RECEIVED_KEY, JSON.stringify(all.slice(0, 500)));
  } catch {
    /* storage unavailable */
  }
}

export function isBearerReceivedTxid(txid: string): boolean {
  return loadReceived().includes(txid);
}

export function isBearerSentTxid(txid: string): boolean {
  return loadBearerCodes().some((r) => r.txid === txid);
}
