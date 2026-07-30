// Local record of escrow (Pin Code Send) tickets this wallet created, so the
// sender can refund after the timelock. The ticket is non-secret; the release
// code is stored too so the sender can re-share it, but it never leaves this
// machine. Same pattern as bearerCodes/pinSends.

const KEY = "dd69.escrowSends";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; // base62

export interface EscrowRecord {
  ticket: string;
  code: string;
  recipient: string;
  amount: number;
  txid: string;
  locktime: number; // unix, sender-refund-after
  createdAt: number; // ms
}

// A machine-generated random release code. 14 base-62 chars ≈ 83 bits, which is
// uncrackable for a time-limited escrow (an on-chain hash can't be rate-limited,
// so entropy is the only defense — a short PIN would be brute-forced).
export function randomCode(len = 14): string {
  const buf = crypto.getRandomValues(new Uint32Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function loadEscrows(): EscrowRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addEscrow(rec: EscrowRecord): void {
  const all = loadEscrows();
  all.unshift(rec);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch {
    /* storage unavailable */
  }
}

export function removeEscrow(txid: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadEscrows().filter((r) => r.txid !== txid)));
  } catch {
    /* storage unavailable */
  }
}
