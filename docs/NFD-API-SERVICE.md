# NFD API Service — architecture and build plan

Status: PLAN (not yet built). Author: NFD workstream. Audience: James (DiviGo
owner) + Geoff. Sibling specs in this folder: NFD-COLLECTION-IMPORT.md,
NFD-CREATOR-COMMISSION.md, NFD-FORGING.md, NFD-REVEAL-UR.md,
NFD-PERC-LAUNCH-SALE.md.

## 0. One-paragraph summary (for Geoff)

NFDs (Divi Collectibles) work today only inside the DD69 desktop wallet, where
the logic is written in Rust. DiviGo is a Node app and cannot reuse that Rust, so
it currently has no way to show or trade NFDs. The fix is one new always-on Node
service, the "NFD API Service", that watches the Divi chain, remembers who owns
what, stores the collectible info and thumbnails, and serves it all over simple
web APIs. Any app (DiviGo, DD69, a website, Siege Worlds) then just calls those
APIs and never has to talk to the blockchain itself. This document is the plan to
build it.

## 1. Current state (what exists)

- **Protocol engine (Rust, desktop only):** `/Users/geoffreymccabe/dd69-nfd/crates/supervisor/src/`.
  Knows how to mint, transfer, forge, blind-reveal, encode/parse the on-chain
  DVXP record, and encrypt private NFDs. Talks to a Divi node with 9 RPC calls
  (see section 4). Not reusable from Node.
- **Arweave relay (Node, live 24/7):** `/Users/geoffreymccabe/dd69-nfd/nfd-relay/server.js`,
  running at `nfds.divi.love`. Uploads art to Arweave (permanent). Has Docker +
  systemd unit in `nfd-relay/deploy/`. Fail-closed auth, spend caps. Reuse as is.
- **DiviGo (Node + MongoDB, live custodial):** repo `DiviGoApp/DiviGoReboot`, tree
  `/Users/geoffreymccabe/divigo-testbot`. Already talks to a Divi daemon
  (`src/coins/blockchain/rpc/divi-rpc.js`) with **address indexing enabled**
  (`getAddressBalance`, `getAddressTxIds`). Already has a REST API framework
  (`gnodejs`, routes via `APP.xpr.add`), Mongo access (`gmongo`), an API-key auth
  model (`APIKeys`, `UserTokens`), and an existing EVM NFT pattern in
  `src/controllers/nfts.js`. Has **no** Divi-native NFD code (no "NFD"/"DVXP"
  anywhere in its tree). Auto-deploys on push via the `/ghUD` webhook.

**The gap:** there is no indexer and no shared API. Nothing keeps authoritative
NFD state; every wallet re-reads the chain live for a single item. That brain is
what this service adds.

## 2. Architecture

```
                 +-------------------------------------------+
   Divi node ----> NFD API SERVICE (new, standalone Node)     |
   (divid,     |  |                                           |
   addr-index) |  |  Indexer loop  ->  State DB (Mongo)        |
               |  |  DVXP parser        (nfds, collections,    |
               |  |  Rule enforcer       listings, offers)     |
               |  |  Thumbnailer   ->  Thumb cache (disk/R2)    |
               |  |  Action layer  ->  builds+submits DVXP tx   |
               |  |  REST API (read + action, API-key auth)     |
               |  +----------------------+--------------------+
               |                         |  arweave upload
               |                         v
               +----- Arweave relay (nfds.divi.love, existing)
                                         |
   Consumers of the REST API:            v
   DiviGo, DD69, website, Siege Worlds   Arweave (permanent art)
```

Kept **separate** from the DiviGo custodial money server on purpose: the money
server holds keys and moves real crypto; this service holds public collectible
data. Separation is the security posture. DiviGo becomes a client of this service.

## 3. The DVXP record format (what the parser must read/write)

Records live in an **OP_META** output: `0x6a` + push (OP_PUSHDATA1 `6a4c` when the
body is over 75 bytes). Framing, all bytes:

- MAGIC `44 56 58 50` ("DVXP")
- 1 byte version|type: `01 02` means version 0x01, type 0x02 = NFD
- 1 byte subtype
- body (subtype-specific, exact length, bounds-checked)

Subtypes (source of truth: `crates/supervisor/src/nfd_record.rs`):

- **0x01 MINT** — arweave_ptr(32) + content_hash(32) + flags(1); then, in flag
  order: thumb_ptr(32) if FLAG_HAS_THUMB(0x02); collection_id(32) + traits_ptr(32)
  if FLAG_IN_COLLECTION(0x04). FLAG_ENCRYPTED = 0x01. Flags derive from which
  pointers are present, so they cannot disagree.
- **0x02 TRANSFER** — mint_txid(32) + new_owner(21: 1 kind byte + 20-byte hash160)
  + wrapkey_ptr(32). Body = 85 bytes.
- **0x03 KEY-ANNOUNCE** — enc_pubkey(32). (Defined, unused today.)
- **0x04 COLLECTION-CREATE** — max_supply(u32, 4 bytes) + meta_ptr(32).
- **0x05 FORGE** — input_a(32) + input_b(32) + collection_id(32). Body = 96 bytes.
- **0x06 REVEAL** — NOT YET DEFINED. Blind-reveal is currently resolved off-chain
  in `reveal.rs`. To make reveal authoritative and trustless it needs an on-chain
  subtype analogous to FORGE: reference the sealed mint, commit to a future block,
  resolve base tier + UR from that block hash. This is a design task for this
  service (and the chain agents), see NFD-REVEAL-UR.md section 4.

**Ownership model:** an NFD's owner = the address that funded the record's
transaction (the funding UTXO). There is no owner field to trust; ownership is
derived. The indexer records it from the transaction inputs.

**The parser is the keystone.** Porting `nfd_record.rs` (parse + encode) to Node
is a fixed, small byte-layout job and unlocks the entire Node side. Low risk.

## 4. Divi node RPC surface (the chain "commands")

The whole system depends on these 9 methods, all of which DiviGo's divid already
exposes: `signmessage`, `listunspent`, `createrawtransaction`,
`signrawtransaction`, `sendrawtransaction`, `validateaddress`, `getrawtransaction`,
`getblockcount`, `getblockhash`.

For the indexer, Divi's **address-index** methods make scanning cheap:
`getAddressTxIds` (all txids touching a collection/treasury/owner address) and
`getAddressBalance`, avoiding a full block-by-block walk in the common case.

## 5. REST API suite

Versioned under `/v1`. Read endpoints are public; action endpoints need an API
key (reuse DiviGo's `APIKeys` model or issue the service's own).

**Read (any app):**
- `GET /v1/nfd/:id` — one NFD: owner, collection, tier, sealed-or-revealed,
  ur_tier, art URL, thumb URL, traits, encrypted flag, history.
- `GET /v1/nfd/:id/thumb` — cached thumbnail (fast, small).
- `GET /v1/nfd/:id/art` — full art (redirect/proxy to Arweave).
- `GET /v1/collection/:id` — metadata, creator, supply, cap, tier art library,
  UR config, sealed art.
- `GET /v1/collection/:id/items?page=` — paginated items.
- `GET /v1/owner/:address/nfds` — everything an address owns.
- `GET /v1/market/listings?collection=` — active listings.
- `GET /v1/market/nfd/:id` — sale/offer status for one NFD.
- `GET /v1/health` — liveness + last block indexed + relay credit.

**Action (API key):**
- `POST /v1/mint` (creator), `/v1/transfer`, `/v1/forge`, `/v1/reveal`.
- `POST /v1/market/list`, `/v1/market/offer`, `/v1/market/buy`,
  `/v1/market/cancel`, `/v1/market/auction/bid`.

**Two action modes** (per app, configurable): custodial — the service funds,
signs, and sends via divid on the user's behalf (DiviGo, which already holds keys);
or unsigned-tx — the service returns an unsigned transaction for a self-custody
wallet (DD69) to sign locally. Same endpoint, different response.

## 6. Data model (Mongo, to match DiviGo)

- **nfds:** { nfd_id (mint txid), collection_id, owner_address, tier, sealed,
  ur_tier, art_ptr, thumb_url, traits, encrypted, mint_block, history[] }
- **collections:** { collection_id, creator_address, name, max_supply,
  minted_count, tier_art[], ur_config, sealed_art, meta_ptr, created_block }
- **listings:** { nfd_id, seller_address, price, kind (fixed|auction), status,
  htlc_info?, created_block }
- **offers:** { nfd_id, buyer_address, amount, status }
- **index_state:** { last_block_scanned, last_block_hash }

## 7. Indexer loop

Poll `getblockcount`; for each new block, either walk it (`getblockhash` +
`getblock` verbosity 2) or, cheaper, pull `getAddressTxIds` for known collection
and treasury addresses. For every transaction, inspect OP_META (0x6a) outputs,
parse DVXP type-0x02 records, and apply them, enforcing:

- **mint** — for a collection mint, must originate from the creator address, and
  must not exceed max_supply.
- **transfer** — must be funded by the current owner.
- **forge** — both inputs owned by the same address, same tier, same collection;
  1000-DIVI fee paid to the creator payout address; the two inputs are burned;
  result tier resolved from the committed future block hash.
- **reveal** — only the owner; base tier + UR resolved from the future block hash.

Enforcement is forkless (the indexer is authoritative for v1); native consensus
opcodes are the later hardening path. Idempotent: re-scanning a block must not
double-apply (key by txid).

## 8. Storage of info + thumbnails

- **Facts** (owner, tier, collection, traits) live in the Mongo state DB above.
- **Full art** stays permanent on **Arweave** via the existing relay
  (`nfds.divi.love`). The on-chain 32-byte pointer maps to an Arweave tx id.
- **Thumbnails** are generated once, at index time (Node `sharp`), and cached on
  the service (local disk or Cloudflare R2), then served via `GET /v1/nfd/:id/thumb`
  behind a CDN. Apps get fast small images without hitting Arweave per request.
- Encrypted NFDs: the relay never sees plaintext (bundles are pre-encrypted). For
  the Perc launch this does not matter, Percs are Public. Encrypted-mode view
  stays a DD69/Rust concern until (if) we port the crypto.

## 9. Marketplace (peer-to-peer)

- **Custodial trade (DiviGo, easy):** DiviGo holds both users' keys, so a swap is
  an internal atomic move plus the two transfer records. No new cryptography.
- **Trustless trade (cross-app / self-custody):** Divi has a TX_HTLC template, so
  two wallets atomically swap NFD-for-DIVI with no trust in each other or us. More
  work; needed only when the buyer is outside DiviGo.
- **Launch blind auction:** front-end + coordinator only, no extra on-chain design
  (see NFD-PERC-LAUNCH-SALE.md). Sits on top of the market endpoints.

## 10. DiviGo integration

DiviGo becomes a consumer: it calls the read APIs to show a user's collectibles
and the marketplace, and either calls the action APIs or (being custodial) submits
the txs through the divid it already runs. Mirror the existing EVM NFT pattern in
`/Users/geoffreymccabe/divigo-testbot/src/controllers/nfts.js` for a Divi-native
controller. No new infrastructure in DiviGo; it already has the API framework,
Mongo, and Divi RPC.

## 11. Hosting / ops (24/7)

Needs a long-running process + a database + a persistent Divi node connection, so
it wants a small VPS or container, the same shape as the relay's Docker/systemd or
alongside DiviGo's daemon fleet. Not pure Cloudflare Workers (long-lived node
connection + DB). Put Cloudflare in front for TLS and thumbnail CDN. Suggested
home: `api.divi.love` (or a path under the existing `nfds.divi.love`).

## 12. Build phases (honest sizing)

1. **Port the DVXP parser to Node** (from `nfd_record.rs`). Keystone. Small.
2. **Indexer loop + Mongo state + rule enforcement.** Biggest piece; address-index
   makes it lighter. Medium.
3. **Wrap the relay + add thumbnail caching.** Mostly reuse. Small.
4. **Read API + thumbnails.** Straightforward once the DB exists. Small-medium.
5. **Action endpoints (mint/transfer/forge/reveal) + custodial/unsigned modes.**
   Roll math already exists and is proven (reveal.rs, forge.rs); port + wire the
   records. Medium.
6. **Marketplace (custodial v1, HTLC later) + launch auction coordinator.** Medium.
7. **Deploy 24/7** (VPS/container, Mongo, node connection, CDN). Small-medium.

## 13. Open decisions (for James / Geoff)

- **Divid to point at:** reuse a DiviGo divid host, or run a dedicated indexing
  node (address-index on). Dedicated is cleaner isolation.
- **DB:** Mongo (matches DiviGo, fastest) vs Postgres (stronger for the ledger).
  Default recommendation: Mongo for v1.
- **Signing:** does the service ever hold keys (custodial signing for DiviGo), or
  is it read-only + unsigned-tx builder, with all signing done by the calling app?
  Read-only is the safer default; DiviGo can sign on its own side.
- **Reveal on-chain record (subtype 0x06):** design it now vs ship reveal as a
  service-authoritative action first and harden to on-chain later.
- **Marketplace v1 scope:** custodial-only to launch, HTLC as a fast follow.

## 14. What we do NOT need to rebuild

Reused as is: the Arweave relay, the reveal/forge roll math (already proven), the
DVXP record spec, DiviGo's divid RPC + Mongo + API framework + auth. The genuinely
new work is the indexer, the state DB, the read/action API, and the marketplace.
