// Is this a real DIVI address?
//
// The app asks its own node. A web page has no node, so it checks the address
// the way the node does: decode it from base58, and confirm its last four bytes
// are the first four of the double SHA-256 of the rest. A typo fails that sum,
// so a mistyped address is refused here and never reaches the treasury.
//
// DIVI's prefixes, from divi-core/divi/src/chainparams.cpp: 30 for an ordinary
// address (it prints as a D), 13 for a script address.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PUBKEY_ADDRESS = 30;
const SCRIPT_ADDRESS = 13;

function base58(text: string): Uint8Array<ArrayBuffer> | null {
  let n = 0n;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  /* Each leading "1" is a leading zero byte. */
  for (const ch of text) { if (ch !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function isDiviAddress(address: string): Promise<boolean> {
  const text = address.trim();
  if (text.length < 26 || text.length > 35) return false;
  const raw = base58(text);
  if (!raw || raw.length !== 25) return false;
  if (raw[0] !== PUBKEY_ADDRESS && raw[0] !== SCRIPT_ADDRESS) return false;
  const body = raw.slice(0, 21);
  const sum = await sha256(await sha256(body));
  return sum[0] === raw[21] && sum[1] === raw[22] && sum[2] === raw[23] && sum[3] === raw[24];
}
