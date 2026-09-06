// PIN encryption for Pin Code Send. The "ticket" is a Bearer claim code
// encrypted with the PIN, so the ticket alone is useless without the PIN (and
// the PIN alone is useless without the ticket). AES-256-GCM with a PBKDF2-
// stretched key, all via the platform's Web Crypto, so we roll no crypto.
//
// Security note: a short PIN is only as strong as the key-stretching makes each
// guess. We use a high PBKDF2 iteration count so brute-forcing an intercepted
// ticket is expensive, but a 6-digit PIN is still finite. Keep amounts modest
// and share the PIN over a channel separate from the ticket.

const PBKDF2_ROUNDS = 250_000;
const PREFIX = "DVP1-";

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "===".slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The webview's lib types want ArrayBuffer-backed views; cast to keep TS happy.
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", buf(enc.encode(pin)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buf(salt), iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt a Bearer code into a shareable PIN ticket (DVP1-...).
export async function encryptTicket(plaintext: string, pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(new TextEncoder().encode(plaintext)))
  );
  const packed = new Uint8Array(salt.length + iv.length + ct.length);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(ct, salt.length + iv.length);
  return PREFIX + b64urlEncode(packed);
}

// Recover the Bearer code from a PIN ticket. Throws if the PIN is wrong (the
// GCM tag fails to authenticate) or the ticket is malformed.
export async function decryptTicket(ticket: string, pin: string): Promise<string> {
  const body = ticket.trim().startsWith(PREFIX) ? ticket.trim().slice(PREFIX.length) : ticket.trim();
  let packed: Uint8Array;
  try {
    packed = b64urlDecode(body);
  } catch {
    throw new Error("That is not a valid PIN ticket.");
  }
  if (packed.length < 16 + 12 + 16) throw new Error("That PIN ticket is malformed.");
  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const ct = packed.slice(28);
  const key = await deriveKey(pin, salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("Wrong PIN, or the ticket does not match.");
  }
}

// A random numeric PIN of the given length (default 6 digits).
export function randomPin(digits = 6): string {
  const buf = crypto.getRandomValues(new Uint32Array(digits));
  let s = "";
  for (let i = 0; i < digits; i++) s += (buf[i] % 10).toString();
  return s;
}
