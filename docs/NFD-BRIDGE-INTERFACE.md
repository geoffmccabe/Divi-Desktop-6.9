# NFD Bridge Interface v1 (FROZEN) — the byte-exact Divi<->Diva contract

Status: FROZEN v1 (2026-08-22). This is the one document both halves of the bridge
implement against: the Divi-side lock/release records (Rust supervisor, this repo)
and the DIVA-side `NFDBridge721` contract (`~/diva`). It fills the single gap both
authoritative specs left open as [BUILDER]: the exact lock-record format.

Authoritative companions (design + rationale, do not duplicate here):
- Builder spec: `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-EVM-AND-NFT-BRIDGE-SPEC.md`
- Phased plan + maturation lock: `/Users/geoffreymccabe/diva/NFT_BRIDGE_PLAN.md`

Where those two and this disagree on the wire format, THIS wins (it is the frozen
contract); where they cover trust model / phasing / content-key, they win.

## 0. Why a dedicated record (resolving the [BUILDER] gap)

Divi permits one OP_META data output per tx, 603-byte cap. The existing NFD
transfer record (subtype 0x02: mint_txid + new_owner + wrapkey_ptr = 85 bytes)
fills that single slot and has no field for a 20-byte DIVA destination address. So
"lock = a plain transfer to the bridge address" cannot carry the destination in
one transaction. v1 therefore defines two dedicated subtypes on the SAME DVXP
codec. They are ownership-affecting records (the indexer treats BRIDGE-OUT as a
transfer to `BRIDGE_DIVI`), adding one parse arm each, not a new codec.

## 1. Canonical identity

- **nfd_id** = the NFD's mint txid, 32 bytes, big-endian as stored on-chain. One
  NFD == one mint tx == one nfd_id, forever.
- **tokenId** (DIVA ERC-721) = `uint256(keccak256(nfd_id))`. Deterministic and
  idempotent: the same NFD always maps to the same tokenId, so a re-mint after a
  round trip reuses it.
- **BRIDGE_DIVI** = the federation-controlled Divi address that holds locked NFDs.
  Phase 1: a single coordinator-controlled address. Phase 2: threshold-controlled
  by the 26/38 POAS quorum. The address bytes are a deploy-time constant shared by
  both sides.

## 2. Records (DVXP type 0x02 = NFD; new subtypes)

Envelope is unchanged: OP_META (0x6a) + push; MAGIC "DVXP" + version 0x01 |
type 0x02 + 1 subtype byte + body. Bodies are fixed-length, exact, bounds-checked.

### 2a. BRIDGE-OUT — subtype 0x07 (user locks; Divi -> DIVA)
Body (fixed 65 bytes; +32 if encrypted):
- `nfd_id`            32 bytes  — the NFD being locked (its mint txid)
- `diva_dest`         20 bytes  — destination EVM address on DIVA
- `nonce`              8 bytes  — the lock nonce (see section 4)
- `maturity_confs`     4 bytes  — u32, Divi confs at which the DIVA token matures
                                  (the fast-transfer knob; see section 5)
- `flags`              1 byte   — bit0 ENCRYPTED (art carries a content key)
- `wrapkey_ptr`       32 bytes  — PRESENT ONLY if ENCRYPTED: pointer to the CK
                                  rewrapped to the federation key
Ownership semantics: this record transfers the NFD's ownership to `BRIDGE_DIVI`.
The funding tx MUST be signed by the current owner. Public NFDs (Percs) omit the
wrapkey_ptr (flags bit0 = 0).

### 2b. BRIDGE-IN — subtype 0x08 (federation releases; DIVA -> Divi)
Body (fixed 62 bytes; +32 if encrypted):
- `new_owner`         21 bytes  — packed Divi address (1 kind byte + 20 hash160),
                                  the returning holder's Divi address
- `diva_burn_ref`     32 bytes  — the DIVA burn tx hash that authorizes this release
- `nonce`              8 bytes  — MUST equal the matching BRIDGE-OUT nonce
- `flags`              1 byte   — bit0 ENCRYPTED
- `wrapkey_ptr`       32 bytes  — PRESENT ONLY if ENCRYPTED: CK rewrapped to
                                  new_owner so they can decrypt again
Ownership semantics: transfers the NFD from `BRIDGE_DIVI` to `new_owner`. The
funding tx MUST be signed by the federation (Phase 1: coordinator key; Phase 2:
quorum-controlled `BRIDGE_DIVI` spend).

## 3. Off-chain authorizations (the cross-chain messages)

### 3a. Mint authorization (Divi lock -> DIVA `NFDBridge721.mintFromLock`)
Carried by any relayer; verified on-chain by the contract.
- `nfd_id`        bytes32
- `to`            address        — the diva_dest from the BRIDGE-OUT
- `nonce`         uint64
- `maturity_confs` uint32
- `meta`          MetaCommit { thumb_ptr bytes32, traits_ptr bytes32,
                               collection_id bytes32, content_ptr bytes32 }
- `sig`           Quorum         — Phase 1: one coordinator ECDSA sig; Phase 2:
                                   26-of-38 validator sigs (same struct, N sigs)
Contract mints `tokenId = keccak256(nfd_id)` to `to`, provisional (see 5),
`tokenURI` built from `meta`. Rejects a used `(nfd_id, nonce)`.

### 3b. Release event (DIVA burn -> federation issues BRIDGE-IN)
`NFDBridge721.burnToRelease(tokenId, diviDest)` burns and emits:
`Released(bytes32 nfd_id, uint256 tokenId, bytes diviDest, uint64 nonce)`.
The federation watches this, waits for DIVA finality (section 6), and issues the
BRIDGE-IN (2b) transferring the NFD from `BRIDGE_DIVI` to `diviDest`.

## 4. Nonce / replay / idempotency

- `nonce` = the round-trip counter for an nfd_id, starting at 0 for the first lock
  and incrementing by 1 each subsequent lock. The Divi-side lock() derives the next
  nonce from the indexer's record of prior bridge cycles for that nfd_id.
- DIVA records used `(nfd_id, nonce)` and rejects reuse; `mintFromLock` also guards
  "tokenId already live" so a resubmitted authorization cannot double-mint.
- Divi side rejects a second BRIDGE-OUT for an nfd_id already owned by
  `BRIDGE_DIVI` (already locked).

## 5. Maturity / fast self-transfer (your speed knob)

- DIVA mints the token **provisional (frozen)** at 1 confirmation of the Divi lock:
  the holder sees it, but it is non-transferable and non-onward-bridgeable, and the
  bridge may burn it.
- It **matures** (fully transferable, bridge loses burn power) once the lock tx is
  `maturity_confs` deep. Default 10; configurable per lock via the BRIDGE-OUT field.
- If the lock is reorged out or drops below its confs during the window, the bridge
  **burns the provisional token** (recall). Because a frozen token cannot move, no
  third party is ever exposed. This is why fast mode is offered only for
  self-transfers (destination is a wallet the sender controls).
- Onward bridges MUST refuse a provisional (unmatured) token.

## 6. Confirmation depths (Phase 1 defaults; all configurable)

- Divi lock -> DIVA provisional mint: **1 conf**.
- Divi lock -> DIVA maturity: **`maturity_confs` (default 10)**. Never above Divi's
  hard 100-block max-reorg cap.
- DIVA burn -> Divi release: Phase 1 = single coordinator after a few DIVA blocks;
  Phase 2 = DIVA block checkpointed into a confirmed DIVI block (the hard gate).

## 7. Trust phases (the wire format does not change between them)

- **Phase 1 (buildable now):** `sig` is a single coordinator key; `BRIDGE_DIVI` is
  coordinator-controlled. Correctness skeleton, regtest + devnet only, no real value.
- **Phase 2 (gated on DIVA POAS):** `sig` becomes a 26/38 quorum; `BRIDGE_DIVI`
  becomes threshold-controlled. Same records, same authorizations, more signers.

## 8. Frozen vs still open

Frozen by this doc: record subtypes 0x07/0x08 and their byte layouts, nfd_id and
tokenId derivation, the mint-authorization and Released shapes, nonce rule,
maturity semantics, Phase-1 depths.

Still open (do not block Phase 1): the exact Quorum signature encoding for Phase 2
(Solidity multisig vs BLS/FROST precompile), the CLTV-refund wrapper for stuck
locks (NFT_BRIDGE_PLAN 5.3), and the content-key view-on-DIVA path (builder spec
6.4 Option B). Percs are Public, so the content-key path is off the launch line.
