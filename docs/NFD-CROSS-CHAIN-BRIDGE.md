# NFD Cross-Chain Bridge — Divi <-> Diva (decentralized), with fast self-transfer

Status: PLAN (not yet built). Audience: James + Geoff + chain agents. Siblings:
NFD-API-SERVICE.md, NFD-CREATOR-COMMISSION.md. Chain facts assumed: Divi =
Bitcoin-derived PoS, OP_META slot ~603 bytes, no SegWit, has TX_HTLC template.
Diva = Parlia / Proof-of-Staked-Authority EVM (BSC-style), chainId 1838, fully
under our control.

## 0. One-paragraph summary (for Geoff)

We can move NFDs from Divi to Diva and back with no custodian and no trusted
middleman, because we control both protocol layers. Each chain checks the other's
proofs itself; the people relaying data between them are untrusted couriers who
cannot forge anything. The clever part that makes it cheap: because Diva is a
proof-of-authority chain, proving to Divi that something happened on Diva is just
"check that two-thirds of Diva's validators signed it," which is small and fast.
And for the fast self-transfer: we mint the token on the far side instantly but
keep it frozen (can't sell, can't move on) until the slow chain is fully settled,
so only the person who chose speed carries the risk.

## 1. Goals

1. Move an NFD from Divi to Diva trustlessly (lock on Divi, mint on Diva).
2. Move it back trustlessly (burn on Diva, unlock on Divi).
3. Exactly one live copy at all times, provably. Never two.
4. From Diva, ride existing EVM bridges onward to Ethereum, Solana, etc.
5. A "fast" mode for self-transfers: usable immediately on the far side, with a
   maturity timelock instead of an up-front finality wait.
6. No hard fork on Divi (soft fork only). Anything on Diva.

## 2. Trust model

**Mutual on-chain light clients + permissionless relayers.**
- Diva runs a Divi light client (built-in) and only mints when it verifies a real
  Divi lock.
- Divi runs a Diva light client (soft-fork opcode + an on-chain header registry)
  and only unlocks when it verifies a real Diva burn.
- Relayers carry headers and proofs between the chains. They are untrusted and
  permissionless; anyone, including the user, can relay. They cannot cheat because
  each chain validates what it receives. Liveness needs one honest relayer.

No custodian, no federation, no multisig required for correctness. This is the
IBC / on-chain-light-client family, not the "trusted bridge signer" family.

## 3. The canonical-copy invariant

At any instant the NFD is in exactly one of:
- **LIVE on Divi** (normal, tradable on Divi).
- **LOCKED on Divi + LIVE on Diva** (bridged out).
- **LOCKED on Divi + IMMATURE on Diva** (fast mode, during maturity window).
- transient in-flight states during a move.

Every transition is gated by a proof from the other chain, so the token can never
be live on both at once.

## 4. On-chain pieces

### 4a. Divi side (DVXP records + one soft-fork opcode)

New DVXP subtypes on the existing envelope (current max is 0x05 FORGE, 0x06 reserved
for REVEAL):
- **0x07 BRIDGE-OUT** — references mint_txid(32), destination chain id (Diva 1838),
  destination EVM address(20), a unique bridge nonce(8), and the chosen maturity
  window(4). Moves the NFD's funding output into the bridge lock script.
- **0x08 BRIDGE-IN (return)** — references the Diva burn (burn id / nonce), unlocks
  the NFD back to the returning owner's Divi address.

**The bridge lock script (soft fork).** The locked output is held under a new spend
condition. We repurpose an unused no-op opcode (an OP_NOPx) into, say,
`OP_VERIFY_DIVA_BURN`. Old Divi nodes treat OP_NOP as a pass (anyone-can-spend);
upgraded nodes enforce the tighter rule: this output is only spendable by a
transaction that presents a valid proof of the matching Diva burn, checked against
the Diva header registry (4c). Adding a spend condition by tightening is exactly
what a soft fork is (same technique as CLTV/CSV), so no hard fork.

Activation: stake-signaled supermajority before enforcement, and monitor upgrade
share, because until supermajority an OP_NOP output is loosely spendable to old
nodes. Standard soft-fork hygiene.

### 4b. Diva side (fully under our control)

- **Divi light client (precompile / system contract).** Stores Divi block headers
  submitted by relayers, validates Divi's PoS header continuity and cumulative
  weight, and verifies a Merkle proof that a BRIDGE-OUT transaction is buried at a
  given depth. Because Divi PoS finality is probabilistic, "buried at depth N" is
  the finality signal (N is a bridge parameter).
- **Bridge contract.** On a valid lock proof it mints the wrapped NFD; on a return
  it burns and emits a canonical `Burned(nonce, owner)` event that becomes the
  proof Divi consumes.
- **Wrapped NFD = standard ERC-721.** tokenId derived deterministically from the
  Divi nfd_id; metadata points at the same Arweave art and the same tier / UR /
  traits, so it is literally the same collectible. EIP-2981 royalty set to the
  creator (best-effort onward, see section 9).

### 4c. Divi's view of Diva: the header registry (why this is cheap)

Divi does not follow Diva inside the node's core. Instead relayers post Diva block
headers into Divi as OP_META records, forming an on-chain Diva header chain that
the soft-fork opcode reads. Verifying a Diva header on Divi = check that 2/3+ of
Diva's known validator set signed it (Parlia / PoA). That is a bounded, cheap
signature check, which is the whole reason a PoA design for Diva makes the hard
direction feasible. The opcode also tracks Diva epoch transitions (validator-set
changes, each signed by the prior set).

This registry approach also solves the size problem (section 6): once a header is
in the registry, a spend only needs a compact Merkle branch plus a reference, not
the whole header, so it fits Divi's small metadata slot.

## 5. The two flows

### 5a. Divi -> Diva (bridge out)

1. Owner publishes a **BRIDGE-OUT (0x07)** on Divi: NFD moves into the lock script,
   naming the Diva destination address, a nonce, and a maturity window.
2. A relayer submits the Divi block header(s) + a Merkle proof of that tx to Diva's
   Divi light client.
3. Diva's bridge contract verifies the proof and **mints** the wrapped NFD to the
   destination address. Safe mode: it waits until the lock is buried N Divi blocks
   deep before minting a fully-live token. Fast mode: see section 7.
4. The NFD is now live on Diva; the Divi copy stays locked.

### 5b. Diva -> Divi (bridge back)

1. Owner **burns** the wrapped NFD on Diva; the contract emits `Burned(nonce, owner,
   diviAddress)`.
2. A relayer submits the Diva header (with validator signatures) + Merkle proof of
   the burn into Divi's header registry.
3. Owner spends the locked Divi output with a **BRIDGE-IN (0x08)** transaction that
   satisfies `OP_VERIFY_DIVA_BURN` against the registry, releasing the NFD back to
   their Divi address.
4. Because Diva is PoA with fast finality, this direction is naturally quick.

## 6. Proof size and Divi's 603-byte limit (real constraint)

Divi has no SegWit and a ~603-byte OP_META slot, so a full proof (header +
validator sigs + Merkle branch) will not fit in one output. Handled by the
registry design: headers are submitted once (batched / one per record, or split
across outputs), and the actual unlock proof is just a Merkle branch (about
32 bytes per tree level) plus a registry reference. That fits comfortably. Header
submission cost is amortized across all bridge traffic, not per token.

## 7. Fast self-transfer (the maturity timelock)

The problem the wait solves: if Diva minted instantly after a shallow Divi lock, a
Divi reorg could erase the lock, leaving the user with a live token on Diva AND the
original still on Divi. That is a double-spend, and it would hurt whoever they then
sold or bridged the Diva token to.

The fast design isolates that risk to the person who opts in:

- In fast mode, Diva **mints immediately** (after 1 or few confirmations) but the
  token is **IMMATURE**: it cannot be transferred, sold, or bridged onward. It just
  sits in the destination wallet, visibly "maturing."
- A **maturity deadline** is set to the normal Divi finality window (the chosen
  maturity in the BRIDGE-OUT record). Until then, if the Divi lock is reorged out,
  anyone can submit a **reorg disproof** to the bridge contract, which **voids
  (burns) the immature token**. No third party was ever exposed, because it could
  not move.
- At maturity with no disproof, the token **matures** into a normal, fully
  transferable, bridgeable ERC-721.

Why it is safe only for self-transfers: the recipient is the sender, so the only
person carrying the reorg risk during the window is the one who chose speed. The
UI enforces this: fast mode is offered only when destination == a wallet the user
controls (or is clearly labeled "advanced / self only"). Sending to someone else,
or listing for sale, requires a matured (safe-mode) token.

User-facing knob:
- **Safe bridge** (default): wait for Divi finality, then a fully-live token
  appears. Use when sending to others or selling.
- **Fast self-bridge**: token appears immediately, frozen, with a maturity
  countdown. Use when moving your own NFD to your own wallet and you do not want to
  wait.

Note on the return leg: because Diva is PoA (fast finality), Diva -> Divi is
already fast, so the maturity feature mainly accelerates the slower Divi -> Diva
direction. Symmetric immature-unlock on Divi is possible but usually unnecessary.

## 8. Liveness, refunds, and stuck funds

- **Self-relay:** the user can always submit their own headers/proofs, so bridging
  never depends on a specific operator.
- **Relayer incentive:** an optional small fee per relayed proof funds a
  permissionless relayer market; correctness never depends on it, only speed.
- **Escape hatch:** if the destination chain is dead and a lock is never consumed,
  a long-timeout reclaim path lets the Divi owner recover the locked NFD. This is a
  liveness-vs-safety tradeoff; the timeout is set long enough that it cannot race a
  legitimate slow mint. Clearly a parameter to tune, and a mild trust assumption we
  should call out.

## 9. Honest limitations

- **Creator commission does not follow onto foreign chains.** Divi can enforce the
  on-chain creator commission for Divi-native transfers, but once an NFD is a
  wrapped token on Diva (and especially after it hops to Ethereum/Solana), only
  best-effort royalty standards (EIP-2981) apply, which marketplaces may ignore.
  Bridging is therefore also a commission-escape path. Options: treat bridge-out as
  commission-exempt (self-custody move) but accept that resales abroad are not
  enforced, or charge a one-time bridge toll. Decision needed.
- **The soft-fork opcode is the biggest and most consensus-sensitive build**, and
  the OP_NOP loose-spend window until supermajority activation is a real (temporary)
  exposure to manage.
- **Divi PoS finality is probabilistic**, so the safe-mode depth N is a
  security/latency tradeoff, not a hard guarantee at shallow depth.
- **Diva validator-set integrity is a trust root for the return leg.** If Diva's
  PoA validators collude they could sign a fake burn. PoS-authority chains carry
  this assumption; keep the validator set meaningful and monitored.
- **Onward bridges (Diva -> Ethereum/Solana) are third-party** and carry their own
  trust models; Diva is the hub, and returning all the way home means
  Ethereum -> Diva -> Divi hop by hop, preserving the one-copy invariant at each hop.

## 10. Integration with the NFD indexer

The NFD API Service (NFD-API-SERVICE.md) learns the new states: an NFD can be
LIVE, LOCKED (bridged out), IMMATURE-ON-DIVA, or RETURNED. The indexer parses
0x07/0x08 and the Diva bridge events (via the same light-client data) so every app
shows "this NFD is on Diva now" / "maturing, unlocks in 12 min" / "back on Divi."
Marketplace listings are blocked for locked or immature tokens.

## 11. Build phases (honest sizing)

1. **Diva side first (you control it fully):** Divi light-client precompile +
   bridge contract + wrapped ERC-721 + maturity/immature logic + disproof path.
   Testable end to end on Diva against Divi regtest headers. Medium-large.
2. **Divi header registry + relayer:** relayers post Diva headers into Divi;
   validate Parlia signatures. Medium.
3. **Divi soft-fork opcode `OP_VERIFY_DIVA_BURN` + lock script + 0x07/0x08 records
   + activation logic.** The hardest, most consensus-sensitive piece. Large.
4. **Fast-mode maturity + disproof wiring** across both sides. Medium.
5. **Indexer + API + UI states** (maturing countdown, locked badges). Medium.
6. **Onward EVM bridge hookup** (LayerZero ONFT or Wormhole from Diva). Small-medium,
   mostly configuration.

Recommended order rationale: everything on Diva can be built and proven first
because it is fully ours; the Divi soft fork is committed only once the far side is
proven, minimizing risk to Divi.

## 12. Open decisions (for Geoff / chain agents)

- Which OP_NOPx to claim for `OP_VERIFY_DIVA_BURN`, and the activation mechanism on
  Divi PoS (stake signaling threshold).
- Safe-mode depth N (Divi confirmations) and default maturity window for fast mode.
- Does bridging pay a creator toll or a bridge toll, given commissions cannot follow
  abroad (section 9)?
- Relayer incentive: baked-in fee, or purely altruistic/self-relay for v1?
- Escape-hatch timeout length, and whether we accept that mild liveness assumption.
- Which onward EVM bridge standard to adopt from Diva (LayerZero ONFT vs Wormhole).

## 13. Confidence

~85% this architecture is sound and buildable given we own both layers. Highest
uncertainty: (a) whether a compact Diva burn proof + Merkle branch comfortably fits
Divi's 603-byte, no-SegWit constraints across all cases, and (b) the engineering
weight of the Divi-side soft-fork opcode and Diva-header validation. Both are
addressable; both should be spiked early on regtest before committing the soft fork.
