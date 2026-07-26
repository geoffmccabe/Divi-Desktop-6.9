// Read-only view of Pin Code Send records this wallet created (written by the
// Pin Code Send panel). Used by the history to name a "move" as a Pin Code Send
// and show the clean amount. Same localStorage key across builds on this machine.

const KEY = "dd69.pinSends";

export interface PinRecord {
  ticket: string;
  code: string;
  amount: number;
  txid: string;
  createdAt: number;
}

export function loadPinSends(): PinRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
