// The guest's real Divi wallet: does a phrase we hand out actually restore?
//
// Run: sh scripts/run-rebels-wallet-tests.sh
//
// THIS IS THE TEST THAT MATTERS. Every other bug in the game costs somebody a
// few minutes. A wrong constant here hands a player twenty-four words that look
// perfect, produce a real Divi address, and restore in Divi Desktop to a
// DIFFERENT, empty wallet. Nothing looks wrong at any point: the address is 34
// characters, it starts with D, it passes the ledger's check, coins arrive at
// it. The player only finds out when they try to take their money out, and by
// then the coins are at an address nobody has the key to.
//
// So the derivation is pinned against known answers rather than against itself.
// The expected addresses below were produced by an independent implementation
// written straight from the node's own source (secp256k1, BIP32 and base58check
// in plain Python, no shared library with the code under test), whose BIP39 half
// was in turn checked against the official TREZOR vector that Divi's own
// openssl_removal_vectors.cpp uses. Two implementations from one specification
// agreeing is worth something; one implementation agreeing with itself is not.

import {
  addressFromWords, makeWallet, loadWallet, saveWallet, walletAtLeast, restoreWallet,
  forgetWalletForTests,
  DIVI_COIN_TYPE, DIVI_PUBKEY_VERSION, ENTROPY_BITS, ADDRESS_SHAPE, DIVI_PATH,
} from "./webWallet";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { base58check } from "@scure/base";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** The published all-abandon phrase, which every wallet in the world can check. */
const KNOWN = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/* ================= THE DERIVATION ================= */
{
  /* Independently derived; see the note at the top of this file. */
  const EXPECTED = [
    "DHnrKW52thFXkbftiAFNnmCjP176vkWnRK",
    "DJ4qwYGSW9oK5PardNcTXpZvD8KQU5B95J",
    "DCunwbUqP4Fa6LDdtRpYJVF2XqGfMLeo1e",
  ];
  EXPECTED.forEach((want, i) => {
    const got = addressFromWords(KNOWN, i);
    ok(`a known phrase gives the Divi address a real wallet would show (key ${i})`,
       got === want, `${got}${got === want ? "" : ` (wanted ${want})`}`);
  });

  /* ---- AND THE CONSTANTS ARE THE RIGHT ONES ----
     Read from the node source, pinned here so a future edit has to be
     deliberate. See the comments in webWallet.ts for why 119 is a trap. */
  ok("the coin type is Divi's registered 301, not the 119 in the prefix table",
     DIVI_COIN_TYPE === 301, `${DIVI_COIN_TYPE}`);
  ok("addresses are versioned 30, which is what makes them start with D",
     DIVI_PUBKEY_VERSION === 30, `${DIVI_PUBKEY_VERSION}`);
  ok("the path is plain BIP44 as hdchain.cpp walks it",
     DIVI_PATH === "m/44'/301'/0'/0", DIVI_PATH);
  ok("phrases are 24 words, as Divi Core itself generates", ENTROPY_BITS === 256);

  /* ---- THE TRAP, DEMONSTRATED ----
     Deriving at the wrong coin type does not fail. It does not warn. It gives a
     perfectly ordinary Divi address that passes every check we have, including
     the ledger's. This is the whole reason the test above pins exact strings. */
  const b58 = base58check(sha256);
  const wrong = (() => {
    const key = HDKey.fromMasterSeed(mnemonicToSeedSync(KNOWN, "")).derive("m/44'/119'/0'/0/0");
    const h = ripemd160(sha256(key.publicKey!));
    const p = new Uint8Array(21); p[0] = 30; p.set(h, 1);
    return b58.encode(p);
  })();
  ok("the wrong coin type yields a DIFFERENT address, which is the danger",
     wrong !== EXPECTED[0], `${wrong}`);
  ok("...and it looks entirely valid, so nothing would catch it but this test",
     ADDRESS_SHAPE.test(wrong), `${wrong} passes the ledger's own check`);
}

/* ================= A NEW WALLET ================= */
{
  forgetWalletForTests();
  const w = makeWallet(1000);
  ok("a new wallet has twenty-four words", w.words.split(" ").length === 24,
     `${w.words.split(" ").length} words`);
  ok("and an address the ledger will accept", ADDRESS_SHAPE.test(w.address), w.address);
  ok("and the address really is that phrase's address",
     addressFromWords(w.words) === w.address);

  /* Two wallets must never be the same wallet. If the randomness were broken -
     a fixed seed, a stubbed generator - this is what would catch it. */
  const seen = new Set<string>();
  for (let i = 0; i < 25; i++) seen.add(makeWallet().address);
  ok("twenty-five wallets are twenty-five different wallets", seen.size === 25, `${seen.size}/25`);

  /* A phrase that is not a phrase must be refused rather than silently turned
     into an address nobody can ever recover. */
  let refused = false;
  try { addressFromWords("not actually a recovery phrase at all"); } catch { refused = true; }
  ok("nonsense is refused, not turned into an unrecoverable address", refused);
}

/* ================= KEEPING IT ================= */
{
  /* A browser's storage, as far as this file is concerned. */
  const make = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
    };
  };

  forgetWalletForTests();                 /* a fresh page, nothing held */
  const s = make();
  ok("a fresh browser has no wallet", loadWallet(s) === null);

  /* ---- THE TRIGGER ----
     Geoff: "let's create the wallet the moment they get their first 1 DIVI
     sphere in the game." Not before. */
  ok("earning nothing makes no wallet", walletAtLeast(0, 1, s).wallet === null);
  ok("earning half a DIVI still makes no wallet", walletAtLeast(0.5, 1, s).wallet === null);
  ok("and nothing was written while it was waiting", s.m.size === 0, `${s.m.size} keys`);

  const first = walletAtLeast(1, 1, s);
  ok("the first whole DIVI makes the wallet", !!first.wallet && first.born);
  ok("and it is a real address", ADDRESS_SHAPE.test(first.wallet!.address), first.wallet!.address);

  /* ---- AND ONLY EVER ONE ----
     A second wallet would strand whatever was paid to the first. */
  const again = walletAtLeast(50, 1, s);
  ok("earning more does NOT make a second wallet",
     again.wallet!.address === first.wallet!.address && !again.born);
  ok("it survives a reload", loadWallet(s)?.address === first.wallet!.address);

  /* Round trip through the store, words and all. */
  const t = make();
  saveWallet(first.wallet!, t);
  ok("saving and loading keeps the phrase intact",
     loadWallet(t)?.words === first.wallet!.words);

  /* A half-written wallet (address but no words) is worse than none: it would
     collect coins nobody can spend. Refuse it. */
  forgetWalletForTests();
  const broken = make();
  broken.setItem("rebels.web.wallet.address", first.wallet!.address);
  ok("an address with no phrase behind it is not a wallet", loadWallet(broken) === null);
}

/* ================= COMING BACK ================= */
{
  forgetWalletForTests();
  /* localStorage cleared, IndexedDB survived: the player must get their wallet
     back, because it has their money in it. */
  const w = makeWallet(7);
  const fresh = new Map<string, string>();
  const s = {
    getItem: (k: string) => fresh.get(k) ?? null,
    setItem: (k: string, v: string) => { fresh.set(k, v); },
  };
  const kept = new Map<string, string>([
    ["rebels.web.wallet.words", w.words],
    ["rebels.web.wallet.address", w.address],
    ["rebels.web.wallet.at", "7"],
  ]);
  const back = await restoreWallet(s, async () => kept);
  ok("a cleared quick copy is restored from IndexedDB", back?.address === w.address,
     `${back?.address ?? "nothing"}`);
  ok("and the phrase came back with it", back?.words === w.words);

  /* Neither copy: no wallet, and emphatically not a new one, or the player
     would quietly be handed a second empty wallet while their coins sat at the
     address of the first. */
  const empty = new Map<string, string>();
  const gone = await restoreWallet(
    { getItem: () => null, setItem: () => { /* nowhere to put it */ } },
    async () => empty,
  );
  ok("with both copies gone it reports nothing rather than inventing a wallet",
     gone === null);
}

/* ================= A BROWSER THAT WILL NOT STORE ANYTHING =================
   A private window, storage blocked, quota full. This nearly shipped as a
   money-losing bug and it is worth spelling out why it was invisible.

   loadWallet answered "no wallet" every time, because nothing could be written
   and so nothing could be read. walletAtLeast therefore minted a BRAND NEW
   wallet on every single sphere the player caught: a different address handed
   to the ledger every few seconds, and twenty-four words thrown away a moment
   after being made. Every individual step looked right. The player would have
   watched a healthy balance climb and then found their coins strewn across a
   hundred addresses nobody on earth had the keys to.

   One wallet per session is the floor. Losing it on reload is acceptable and
   the interface has to say so; minting a hundred is not. */
{
  forgetWalletForTests();
  /* Storage that swallows every write and returns nothing, without throwing -
     which is how a real blocked browser behaves. */
  const dead = { getItem: () => null, setItem: () => { /* silently dropped */ } };

  const addresses = new Set<string>();
  for (let sphere = 1; sphere <= 40; sphere++) {
    const got = walletAtLeast(sphere, 1, dead);
    if (got.wallet) addresses.add(got.wallet.address);
  }
  ok("forty spheres in a browser that cannot store make ONE wallet, not forty",
     addresses.size === 1, `${addresses.size} distinct addresses`);

  /* And storage that throws on every access, which is the other way browsers
     refuse: it must not take the game down either. */
  forgetWalletForTests();
  const angry = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  const hostile = new Set<string>();
  let threw = false;
  try {
    for (let i = 1; i <= 10; i++) {
      const got = walletAtLeast(i, 1, angry);
      if (got.wallet) hostile.add(got.wallet.address);
    }
  } catch { threw = true; }
  ok("storage that throws does not throw out of the game", !threw);
  ok("and still yields exactly one wallet", hostile.size === 1, `${hostile.size}`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
