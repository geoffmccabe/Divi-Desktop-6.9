// Local record of Pin Code Sends this wallet created, so the sender can reclaim
// an unredeemed one. Under the hood each is a Bearer code (revocable), so the
// key is also in the node's wallet; this only holds the code so reclaim is one
// click. Local to this machine, never sent anywhere.

const KEY = "dd69.pinSends";

export interface PinRecord {
  ticket: string; // the PIN-encrypted, shareable ticket (DVP1-...)
  code: string; // the underlying bearer code (for reclaim)
  amount: number;
  txid: string;
  createdAt: number; // ms
}

export function loadPinSends(): PinRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addPinSend(rec: PinRecord): void {
  const all = loadPinSends();
  all.unshift(rec);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch {
    /* storage unavailable */
  }
}

export function removePinSend(txid: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadPinSends().filter((r) => r.txid !== txid)));
  } catch {
    /* storage unavailable */
  }
}
