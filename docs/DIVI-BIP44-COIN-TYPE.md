# Divi's BIP44 coin type is 301, not 119

**If you are deriving a Divi address from a seed phrase anywhere in this repo,
read this first. It will cost you a day otherwise, and it can cost somebody
their coins.**

The derivation path is:

    m/44'/301'/0'/0/0

Not `m/44'/119'/...`, however reasonable 119 looks when you go and check.

---

## Why 119 looks right, and is not

Divi's `chainparams.cpp` contains **two plausible coin-type numbers, seventeen
lines apart, in the same block**, and they disagree.

From `~/Divi-Blockchain_6.9/divi/src/chainparams.cpp`, `CMainParams`:

| line | what it says | value |
|---|---|---|
| 223 | `nExtCoinType = 301;` | **301** — the BIP44 coin type |
| 240 | `base58Prefixes[EXT_COIN_TYPE] = 0x80 0x00 0x00 0x77` | 0x77 = **119** |

The constant *called* `EXT_COIN_TYPE` is the wrong one. `nExtCoinType`, which is
not named after the thing it is, is the right one.

### The evidence that settles it

Two independent checks, both done rather than assumed:

1. **SLIP-44**, the registry BIP44 coin types come from, lists
   `301 | DIVI | Divi Project`. There is no Divi at 119.
2. **The prefix is 119 on every network, so it cannot be a coin type.** In the
   same file, testnet sets `nExtCoinType = 1` (line 329, the standard testnet
   value) while *still* setting `base58Prefixes[EXT_COIN_TYPE]` to `0x80000077`
   — the same 119 (line 348). A number that stays 119 while the coin type
   changes from 301 to 1 was never the coin type. Regtest sets the prefix to
   `0x80000001` (line 428) with the comment "Testnet divi BIP44 coin type is
   '1'", which is the one place the file admits what the field is supposed to
   mean.

So `base58Prefixes[EXT_COIN_TYPE]` on mainnet is a stale constant that nobody
has ever derived anything from.

---

## Why getting it wrong is dangerous rather than merely broken

Deriving at 119 does **not** fail. It produces a perfectly well-formed Divi
address: right `D` prefix, right length, right base58 checksum. It will pass
`isDiviAddress()`. It will look correct in a UI, in a log, and to a person
reading it.

It is simply a different wallet, on a branch of the tree that the real Divi
wallet software will never look at. Coins sent to it are not recoverable
through any normal path — the seed phrase is right, the address is real, and
the money is at a place nothing you own will ever scan.

That is the failure mode to be afraid of: not an error, but a silent, valid,
wrong answer.

---

## Where this matters today

- `ui/src/web-rebels/webWallet.ts` — the browser wallet a web guest is given.
  The path constant there carries this warning next to it.

Anywhere else that ever derives an address — a recovery tool, a payout script,
a hardware-wallet integration — has the same trap waiting.

---

## How to check you have it right

Derive from a known test phrase and compare the first receive address against
the Divi wallet's own for the same phrase. If they differ while the phrase is
identical, the coin type is the first thing to suspect.

Do this against a **test** phrase with nothing in it. Never paste a real seed
phrase into anything to check a derivation path.

---

## Provenance

Found by the payouts session while building `webWallet.ts` (2026-Sep-27) and
written down here rather than left in two chat transcripts, because a warning
that lives in a conversation protects nobody. The line numbers and the testnet
argument above were verified against the source and against SLIP-44 before this
file was written.
