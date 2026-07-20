# Divi Proof of Existence: integration guide

Written for agents and developers on **other** Divi projects (Divi Love Scan,
Love Nodes, the Ethereum bridge, Divi Collectibles/NFD, DiviGo) who need to read,
display, verify or produce Proof-of-Existence records.

Everything below is what is **actually built and verified**, with gaps called out
explicitly. If a section says NOT BUILT, do not design against it.

Last updated: 2026-Jul-20. Source of truth for the chain side is
`Divi-Blockchain_6.9/docs/SOFTFORK-OPCODES.md` and
`docs/POE-NFT-RECORD-FORMAT.md` in that repo.

---

## 1. What Proof of Existence is here

A user picks a file. The wallet computes its SHA-256 **locally** and writes only
that 32-byte fingerprint into a Divi transaction. The block's timestamp then
proves the file existed, unchanged, by that moment.

The chain never sees the file, its name, or anything about it. That matters for
integration: **the chain cannot tell you what a proof was for.** All human
context (title, project, preview) lives off-chain, in the wallet, and travels
only via the JSON export in section 6.

---

## 2. Status at a glance

| Capability | State | Notes |
|---|---|---|
| Forkless anchor via `OP_META` | **Live on mainnet** | What the wallet uses today |
| `OP_POE` / `OP_NFD` opcodes | **Built, not deployed** | Branch `feat/opcodes`, no activation |
| `createpoe` / `verifypoe` RPCs | **Built** | Same branch |
| `createnfd` / `verifynfd` RPCs | **Built** | Body is opaque to the chain |
| `getpoe` / `listpoe` native index | **NOT BUILT** | Phase 2. Do not promise it |
| Structural validation of records | **NOT BUILT** | Any push-only data is accepted |
| Merkle batch anchors (subtype 3) | Format defined, tooling in chain repo | Wallet does single anchors only |
| C2PA Content Credentials | **Read only** | See section 7 |

---

## 3. On-chain formats

There are **two** valid forms. A verifier MUST accept both.

### 3a. Forkless record (what mainnet uses today)

```
scriptPubKey = OP_META(0x6a) PUSHDATA(payload)
```

`OP_META` is Divi's `OP_RETURN`. Payload envelope:

| field | size | value |
|---|---|---|
| magic | 4 | `DVXP` = `0x44 0x56 0x58 0x50` |
| version | 1 | `0x01` |
| type | 1 | `0x01` PoE, `0x02` NFD, `0x03` PoE batch root |
| hashAlg | 1 | `0x01` = SHA-256 |
| hash | 32 | the document digest |

Total 39 bytes. The full script hex for a PoE anchor begins
`6a27` + `44565850010101` + `<64 hex chars of digest>`, where `0x27` is the
39-byte push length. Matching on the constant `44565850010101` is the cheapest
reliable detector.

### 3b. Native opcode record (built, awaiting activation)

```
scriptPubKey = OP_POE(0xba) PUSHDATA(version(1) | subtype(1) | digest(32))
scriptPubKey = OP_NFD(0xbb) PUSHDATA(version(1) | subtype(1) | body...)
```

34-byte body for PoE. `subtype` is `0x01` single document or `0x03` Merkle batch
root, carrying forward the meanings of the forkless types.

Both opcodes are **undefined in the interpreter**, so any attempt to spend such
an output fails with a bad-opcode error on old and new nodes alike. This was
chosen over redefining an `OP_NOP`, which would have made these outputs
**anyone-can-spend on old nodes** (a NOP is a no-op, and the following data push
leaves a truthy stack). Outputs are 0-value, dust-exempt, unspendable, and
pruned from the UTXO set.

### 3c. Rules that constrain integrators

- **One data-carrier output per transaction.** `OP_META`, `OP_POE` and `OP_NFD`
  all count toward the same limit (`MempoolConsensus.cpp`, reason
  `multi-op-meta`). A transaction therefore **cannot** carry both an NFD record
  and a separate PoE anchor. Plan for one record per transaction.
- **Datacarrier limit is 603 bytes** (`MAX_OP_META_RELAY`), which is 7.5x
  Bitcoin's 80. It is relay policy, not consensus.
- Transactions are v1 only. No SegWit, no witness data anywhere in Divi.

---

## 4. The propagation gate (read this before producing anchors)

**Nodes that predate the soft fork treat `OP_POE` outputs as non-standard and
drop them rather than relaying.** That is essentially all of mainnet today. An
anchor built in the native form will very likely never reach a staker and never
confirm, while appearing to have succeeded.

This is invisible on regtest, where one node mines its own transactions. It cost
us a real bug.

The wallet therefore chooses by network, in `crates/supervisor/src/poe.rs`:

- **mainnet** uses the forkless `OP_META` form,
- **regtest and testnet** use native `OP_POE` when the node offers `createpoe`,
- `DIVI_POE_NATIVE=1` forces native, `=0` forces forkless,
- an unreachable or unrecognised node is treated **as mainnet**, the cautious
  direction.

If you write anchoring code, copy this rule. Flipping it to native on mainnet is
a single decision to be made **after** the upgraded node is widely deployed, not
per-project.

---

## 5. RPC surface

Available only on a node built from `feat/opcodes`. Probe with `help` or treat a
`-32601` method-not-found as "old node, use the forkless path".

```
createpoe "<64-hex sha256>" (subtype)   -> "<txid>"
verifypoe "<txid>" "<64-hex sha256>"    -> { matched, confirmations, blocktime, subtype }
createnfd "<hex body>"                  -> "<txid>"
verifynfd "<txid>"                      -> { found, body_hex, confirmations, blocktime }
```

Behaviour worth knowing:

- `createpoe` funds, signs and broadcasts in one call. It needs an unlocked
  wallet and about 0.0002 DIVI. Fee is a flat 10,000 satoshis regardless of
  record size.
- **`matched` is independent of confirmation.** A transaction sitting in the
  mempool returns `matched: true`, `confirmations: 0`, `blocktime: 0`. Treat a
  proof as valid only when `confirmations >= 1`. The wallet gates on this; your
  UI must too.
- `verifypoe` needs the transaction to be findable. With `-txindex` (Divi's
  default is **on**) this always works. With `-txindex=0` the fallback walks the
  UTXO set, and since the PoE output is pruned as unspendable, the anchor becomes
  **unfindable once its change output is spent**. Do not turn txindex off on a
  node that serves verification.
- `getpoe` and `listpoe` **do not exist**. To enumerate anchors you must scan
  blocks yourself or run `contrib/poe/poe_index.py` from the chain repo.

---

## 6. Verifying independently, and the JSON export

### The verification algorithm

Anyone can verify without a wallet, without permission, and without our code:

1. SHA-256 the original file.
2. Fetch the anchoring transaction by txid.
3. Look through its outputs for either record form in section 3.
4. Compare the 32-byte digest.
5. Read the containing block's timestamp. **That** is the proven-by time.
6. Require at least 1 confirmation. Reject anything still in the mempool.

For a Merkle batch (subtype `0x03`) the on-chain digest is a root, and the holder
supplies an audit path. The construction is **RFC 6962** (Certificate
Transparency), not Bitcoin's: `leaf = SHA256(0x00 || doc_hash)`,
`node = SHA256(0x01 || left || right)`, odd levels promoted rather than
duplicated. The domain separation is deliberate and blocks the CVE-2012-2459
forgery that plain Bitcoin-style trees allow. Reference implementation:
`contrib/poe/poe_batch.py` in the chain repo.

### JSON export schema (v1)

This is the interchange format. **Divi Love Scan and Love Nodes should read
this** to display a user's collection. It is self-contained by design, so a
recipient needs no wallet.

```json
{
  "format": "divi-poe-export",
  "version": 1,
  "exportedAt": "2026-07-20T04:31:00.000Z",
  "count": 12,
  "hashAlgorithm": "sha256",
  "howToVerify": ["...plain-language steps..."],
  "projects": ["Legal docs", "Digital art"],
  "records": [
    {
      "project": "Digital art",
      "title": "Study in blue",
      "sha256": "<64 hex>",
      "txid": "<64 hex>",
      "explorerUrl": "https://scan.divi.love/tx/<txid>",
      "createdAt": "2026-07-19T22:10:00.000Z",
      "provenAt": "2026-07-19T22:11:04.000Z",
      "confirmed": true,
      "file": { "name": "study.png", "size": 184320, "mime": "image/png", "width": 1200, "height": 800 },
      "publicThumbnail": "data:image/jpeg;base64,..."
    }
  ]
}
```

Notes for consumers:

- `provenAt` is the **block time** and is the only date that carries proof
  weight. `createdAt` is when the user's wallet broadcast it and is informational.
- `confirmed: false` means it is not yet proven. Display it differently.
- `publicThumbnail` is opt-in, at most 500px on the longest edge, and is **not
  part of the proof**. Never present it as evidence of anything.
- Absence of a thumbnail is normal and expected. Most proofs are private files.
- `project` and `title` are free text chosen by the user and may be null.
- Parsers should skip any record whose `txid` or `sha256` is not 64 hex chars.

Producer and parser: `ui/src/wallet/poeHistory.ts`
(`buildPoeExport`, `parsePoeExport`, `mergePoeImport`).

---

## 7. C2PA Content Credentials

The wallet **reads and verifies** C2PA manifests
(`crates/supervisor/src/c2pa_read.rs`, Tauri command `c2pa_inspect`). It does not
create or sign them.

Facts that constrain any integration:

- C2PA's timestamp slot is **RFC 3161 tokens from a trust-listed authority**. A
  blockchain anchor **cannot** be the C2PA timestamp. There is no provision for
  an alternative time source.
- Everyone who has combined the two (Numbers Protocol, Starling Lab) runs the
  chain **alongside** C2PA and cross-references. That is the pattern to follow.
- The reserved namespace for a Divi anchor inside a manifest is
  **`org.divi.poe`** (reverse-domain, as the spec requires). A bare `divi.poe`
  would be non-conformant. Constant: `DIVI_POE_LABEL`.
- Custom assertions are signature-covered and tamper-evident, but mainstream
  viewers such as Adobe Verify will **not display them**.
- The SDK is built with `rust_native_crypto` (no OpenSSL, deliberately, since the
  chain refactor removed it) and **without** `fetch_remote_manifests`, so reading
  a file never touches the network. Keep both settings if you reuse this.

---

## 8. Roadmap and open gaps

In rough priority order:

1. **Deploy the upgraded node**, then flip the mainnet gate in section 4 so
   anchors use `OP_POE`. This is the unlock for everything native.
2. **Structural validation** of `OP_POE` bodies at the consensus layer. Today any
   push-only data after the opcode is accepted and classified `"poe"`, so an
   explorer showing "poe" is not evidence of a well-formed record. Validate
   the 34-byte shape yourself.
3. **`getpoe` / `listpoe` and the built-in index.** Until this exists, indexing
   is every consumer's own problem.
4. **Tests.** There is currently no test coverage for `OP_POE` / `TX_POE` in the
   chain repo.
5. Merkle batching in the wallet UI. Format and tooling exist; the wallet only
   does single anchors.
6. C2PA manifest **creation** with an `org.divi.poe` assertion. Blocked on the
   key-protection story for a desktop app, not on code.

---

## 9. Things not to claim

These have all been checked and are wrong or unearned:

- **"C2PA compliant" or "C2PA certified."** Conformance is a formal listing for
  products that GENERATE credentials, publicly checkable in one click. We read
  credentials. That confers nothing.
- **"No external indexer needed."** The built-in index does not exist yet.
- **"Enforced structural validity."** Not implemented.
- **"The blockchain timestamp is the C2PA timestamp."** The spec does not allow it.
- **"Proven"** for anything with zero confirmations.
- Anything implying the chain stores the file, or can show what a proof was of.
  It stores 32 bytes and nothing else.

---

## 10. Where the code lives

| Area | Path |
|---|---|
| Anchor and verify logic | `Divi-Desktop-6.9/crates/supervisor/src/poe.rs` |
| C2PA reader | `Divi-Desktop-6.9/crates/supervisor/src/c2pa_read.rs` |
| Tauri commands | `Divi-Desktop-6.9/crates/app/src/main.rs` |
| Local records, export/import | `Divi-Desktop-6.9/ui/src/wallet/poeHistory.ts` |
| PoE screens | `Divi-Desktop-6.9/ui/src/wallet/Poe*.tsx` |
| Opcodes, RPCs (C++) | `Divi-Blockchain_6.9` branch `feat/opcodes`, `divi/src/rpcpoe.cpp`, `divi/src/script/` |
| Record format spec | `Divi-Blockchain_6.9/docs/POE-NFT-RECORD-FORMAT.md` |
| Soft-fork spec | `Divi-Blockchain_6.9/docs/SOFTFORK-OPCODES.md` |
| Batch and index tooling | `Divi-Blockchain_6.9/contrib/poe/` |

Questions about the chain side belong to the agent on `feat/opcodes`. Questions
about the wallet side, the export format, or C2PA belong here.
