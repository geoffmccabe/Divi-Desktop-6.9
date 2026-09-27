// A real Divi wallet, made in the browser, for a player who has never had one.
//
// Geoff, 2026-Sep-26: "If they haven't logged in to the game with a node, then
// they should be given a Divi wallet, a real one, with 1 Divi in it... This will
// help to create new Divi holders." And then: "let's create the wallet the
// moment they get their first 1 DIVI sphere in the game. It can happen in the
// background."
//
// So it is not a handout for turning up. A player earns their first whole DIVI
// in the game, and at that moment they quietly become a Divi holder: twenty-four
// words and an address that any Divi wallet in the world will recognise. They
// are not asked anything and nothing interrupts the game.
//
// RECEIVING NEEDS NO SIGNING, WHICH IS WHY THIS IS SMALL
// -----------------------------------------------------
// To be paid, all a player needs is an address. Spending is what needs a signed
// transaction, and nothing here spends: when they want to move their coins they
// type these same words into Divi Desktop, or any BIP44 wallet, and it is their
// wallet. That keeps this file to key derivation and an address encoding, with
// no transaction building anywhere near the browser.
//
// THE SEED NEVER LEAVES THIS MACHINE
// ----------------------------------
// The room and the ledger are told the ADDRESS and nothing else. They could not
// spend these coins if they were broken into, and neither could we.
//
// ⚠ THE WORDS ARE STORED IN THE CLEAR, and that is a deliberate consequence of
// "it can happen in the background": a wallet made without asking the player
// anything cannot have a password on it, because there was no moment to ask for
// one. This is the right trade for game winnings and it is exactly how the guest
// id already works (see pilot.ts), but it means this is a pocket wallet and the
// interface must say so. Anyone who wants to keep real money here should write
// the words down and move them into a wallet they control properly.

import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { base58check } from "@scure/base";
import { idbAll, idbPut } from "./webStore";

/* ================= THE NUMBERS THAT MUST BE RIGHT =================
   Every one of these was read out of the node's own source rather than assumed,
   because all four have a plausible wrong value that produces an address which
   LOOKS perfectly valid. Nothing would appear broken until a player typed their
   words into Divi Desktop and found an empty wallet. */

/**
 * Divi's registered coin type, from `nExtCoinType` in CMainParams
 * (Divi-Blockchain_6.9/divi/src/chainparams.cpp) and from SLIP-0044.
 *
 * ⚠ The SAME FILE also sets `base58Prefixes[EXT_COIN_TYPE]` to 0x80000077,
 * which reads as coin type 119, and that number is a trap: it is the prefix for
 * SERIALISING an extended key and has nothing to do with derivation. The code
 * that actually derives (`CHDChain::DeriveChildExtKey` in hdchain.cpp) calls
 * `Params().ExtCoinType()`, which is 301. Deriving at 119 gives a real, valid,
 * completely different address.
 */
export const DIVI_COIN_TYPE = 301;

/** Where a Divi wallet keeps its first receiving key. Plain BIP44, exactly as
 *  hdchain.cpp walks it: purpose / coin type / account hardened, then change
 *  and index. */
export const DIVI_PATH = `m/44'/${DIVI_COIN_TYPE}'/0'/0`;

/** The byte that makes an address start with D. `base58Prefixes[PUBKEY_ADDRESS]`
 *  in CMainParams. */
export const DIVI_PUBKEY_VERSION = 30;

/** Twenty-four words, because that is what Divi Core itself generates: see
 *  `CMnemonic::Generate(256)` in hdchain.cpp. Matching it means a phrase from
 *  here looks and behaves exactly like a phrase from the desktop wallet. */
export const ENTROPY_BITS = 256;

/** What a valid Divi address looks like. The same test the ledger applies
 *  (contrib/rebels-room/src/ledger.ts), repeated here so a bad address is
 *  caught the moment it is made rather than when it is first paid to. */
export const ADDRESS_SHAPE = /^D[1-9A-HJ-NP-Za-km-z]{33}$/;

const b58 = base58check(sha256);

/* ================= MAKING ONE ================= */

/** The player's wallet: their words, and the address those words produce. */
export interface WebWallet {
  /** Twenty-four BIP39 words. This IS the money. */
  words: string;
  /** The first receiving address, which is all the server is ever told. */
  address: string;
  /** When it was made, for the panel to show. */
  at: number;
}

/**
 * Turn a recovery phrase into a Divi address.
 *
 * Exported because it is the one thing worth testing against a known answer:
 * feed it a published phrase and the address must match what a real Divi wallet
 * would show for it. See webWallet.test.ts.
 */
export function addressFromWords(words: string, index = 0): string {
  if (!validateMnemonic(words, wordlist)) throw new Error("not a valid recovery phrase");
  /* An empty passphrase, which is what Divi Core defaults to: "NOTE: default
     mnemonic passphrase is an empty string" (hdchain.cpp). A phrase made here
     with a passphrase would not restore there without it. */
  const seed = mnemonicToSeedSync(words, "");
  const key = HDKey.fromMasterSeed(seed).derive(`${DIVI_PATH}/${index}`);
  if (!key.publicKey) throw new Error("no public key from that phrase");
  /* Address = base58check(version byte + ripemd160(sha256(compressed pubkey))).
     The compressed key is the one Divi hashes; an uncompressed one gives a
     different and equally valid-looking address. */
  const hash = ripemd160(sha256(key.publicKey));
  const payload = new Uint8Array(1 + hash.length);
  payload[0] = DIVI_PUBKEY_VERSION;
  payload.set(hash, 1);
  const address = b58.encode(payload);
  /* Checked rather than trusted. If any constant above is ever wrong this is
     where it should stop, not three weeks later in somebody's empty wallet. */
  if (!ADDRESS_SHAPE.test(address)) throw new Error(`derived a malformed address: ${address}`);
  return address;
}

/**
 * A brand new wallet.
 *
 * The randomness is the browser's own cryptographic source, by way of
 * @scure/bip39. A browser too old to have one throws rather than quietly making
 * a guessable wallet, which is the one failure here that must never be soft.
 */
export function makeWallet(now = Date.now()): WebWallet {
  const words = generateMnemonic(wordlist, ENTROPY_BITS);
  return { words, address: addressFromWords(words), at: now };
}

/* ================= KEEPING IT =================
   The same two places the guest id lives (pilot.ts): IndexedDB for the copy a
   browser treats as the site's real data, and localStorage for an instant
   synchronous read. Either one surviving is enough. */

const WORDS_KEY = "rebels.web.wallet.words";
const ADDRESS_KEY = "rebels.web.wallet.address";
const MADE_KEY = "rebels.web.wallet.at";

type Kv = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * The wallet this session is using, whatever the storage did.
 *
 * ⚠ THIS IS NOT AN OPTIMISATION, it is the fix for a money-losing bug. Without
 * it, a browser that refuses to store anything (a private window, storage
 * blocked, quota full) made loadWallet answer "no wallet" every single time it
 * was asked. walletAtLeast would then mint a FRESH wallet on every sphere the
 * player caught, hand the ledger a different address each time, and scatter
 * their coins across a trail of addresses whose words were thrown away a
 * fraction of a second after they were made.
 *
 * Holding it in memory means a blocked browser still gets ONE wallet that works
 * for as long as the tab is open. It is still lost on reload, and the interface
 * has to say so, but losing a wallet you were warned about beats silently
 * strewing somebody's winnings across a hundred dead addresses.
 */
let thisSession: WebWallet | null = null;

/** For tests: forget the session's wallet, as a fresh page would. */
export function forgetWalletForTests(): void { thisSession = null; }

function keep(storage: Kv | null, key: string, value: string): void {
  try { storage?.setItem(key, value); } catch { /* not kept; still usable this session */ }
  void idbPut(key, value);
}

/** The wallet this browser already has, or null. Never makes one. */
export function loadWallet(storage: Kv | null = safeStorage()): WebWallet | null {
  try {
    const words = storage?.getItem(WORDS_KEY);
    const address = storage?.getItem(ADDRESS_KEY);
    /* A whole wallet from storage wins: it is the one that survives a reload. */
    if (words && address && ADDRESS_SHAPE.test(address)) {
      return { words, address, at: Number(storage?.getItem(MADE_KEY)) || 0 };
    }
    /* Anything less - nothing stored, half stored, or stored malformed - falls
       back to the one this session is already using. Returning null instead is
       what made a blocked browser mint a fresh wallet on every sphere. */
    return thisSession;
  } catch {
    return thisSession;
  }
}

/** Write one down. */
export function saveWallet(w: WebWallet, storage: Kv | null = safeStorage()): void {
  /* Memory first, and unconditionally: it is the copy that cannot fail, and it
     is what stops a second wallet ever being minted. */
  thisSession = w;
  keep(storage, WORDS_KEY, w.words);
  keep(storage, ADDRESS_KEY, w.address);
  keep(storage, MADE_KEY, String(w.at));
}

/**
 * The wallet, making one if this player has earned enough to deserve it.
 *
 * Returns the wallet and whether it was born just now, so the caller can decide
 * whether to say anything. It never makes a second one: a player has exactly one
 * wallet for as long as this browser remembers anything at all.
 */
export function walletAtLeast(
  earned: number,
  threshold = 1,
  storage: Kv | null = safeStorage(),
  now = Date.now(),
): { wallet: WebWallet | null; born: boolean } {
  const held = loadWallet(storage);
  if (held) return { wallet: held, born: false };
  if (!(earned >= threshold)) return { wallet: null, born: false };
  const made = makeWallet(now);
  saveWallet(made, storage);
  return { wallet: made, born: true };
}

/**
 * Before the game starts: if the quick copy was cleared but IndexedDB still has
 * the wallet, put it back.
 *
 * Exactly what restoreGuest does for the guest id, and for a much better reason:
 * losing this one loses money. Never makes a NEW wallet.
 */
export async function restoreWallet(
  storage: Kv | null = safeStorage(),
  all: () => Promise<Map<string, string>> = idbAll,
): Promise<WebWallet | null> {
  const saved = await all().catch(() => new Map<string, string>());
  for (const key of [WORDS_KEY, ADDRESS_KEY, MADE_KEY]) {
    let quick: string | null = null;
    try { quick = storage?.getItem(key) ?? null; } catch { /* blocked */ }
    const kept = saved.get(key) ?? null;
    if (!quick && kept) { try { storage?.setItem(key, kept); } catch { /* blocked */ } }
    else if (quick && quick !== kept) void idbPut(key, quick);
  }
  return loadWallet(storage);
}

/** Just the address, for the join message. Null when there is no wallet yet. */
export function walletAddress(storage: Kv | null = safeStorage()): string | null {
  return loadWallet(storage)?.address ?? null;
}
