# DIVA + Divi Node and Supervisor Spec

**Status:** Working spec for an agent building a supervisor that runs a Divi node and a DIVA node together on one machine.
**Date:** 2026-Sep-21
**Audience:** the agent (or engineer) building the combined node supervisor. Implement against this document, and confirm the few flagged values against the live config on the machine before relying on them.

**How to read this:** Section 8 separates what is REAL TODAY from what is a DESIGN TARGET. Do not build consensus, block-time, or signing behavior as if the targets are final. Build the process management now; leave clean seams for the consensus/bridge pieces that land later.

---

## 1. Purpose

One supervisor process manages, on a single machine, at the same time:

1. a **Divi** node (the UTXO chain, C++ daemon `divid69`), and
2. a **DIVA** node (the EVM side-chain, a BSC/geth fork),

plus the **overlay scanner** and, later, the **checkpoint/bridge** duties that tie the two chains together. The supervisor owns process lifecycle, health, graceful shutdown, resource monitoring, and config for both nodes. It is an extension of the existing DD69 Rust supervisor (`/Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor`), which already manages the Divi side and writes OP_META. Reuse and extend it; do not fork a second supervisor.

## 2. The two nodes at a glance

| | Divi node | DIVA node |
|---|---|---|
| Software | `divid69` (C++, Bitcoin-derived UTXO daemon) | `geth`, a fork of `bnb-chain/bsc` |
| Model | UTXO + OP_META overlay | EVM (account-based) |
| Binary (current) | `.../DD69/divid/unpacked/divid69` | `/Users/geoffreymccabe/diva/bsc/build/bin/geth` |
| Chain id / net | Divi mainnet | **1838** |
| Live memory (measured) | ~1.4 GB RSS (mainnet node, running now) | tiny today (young dev chain, ~20 MB data) |
| RPC | port **51473**, `rpcthreads=16` | HTTP read-only on `127.0.0.1:8548`; full access over IPC |
| Shutdown | **SIGTERM only, never SIGKILL/-9** | SIGTERM/SIGINT, allow flush time |

## 3. DIVA node spec (confirmed from the running config)

- **Binary:** `/Users/geoffreymccabe/diva/bsc/build/bin/geth` (BSC fork, so Parlia/POAS is available in the codebase even though it is not the mode running today).
- **Chain id:** 1838.
- **Genesis:** `/Users/geoffreymccabe/diva/genesis/diva-genesis.json`. Gas limit **30,000,000**. Modern EVM forks on from genesis (Shanghai/Cancun/Prague, so EIP-7702, the RIP-7212 passkey precompile, BLS12-381, KZG).
- **Block production:** on-demand. Today via `--dev --dev.period 0` (a block is produced only when there is a transaction, verified working; no empty blocks). Data dir `/Users/geoffreymccabe/diva/divadata`.
- **RPC surface (a security split to preserve):** read-only HTTP on `127.0.0.1:8548` exposing only `eth,net,web3`; transaction sending is done over the local **IPC** socket `/Users/geoffreymccabe/diva/diva.ipc`, never over the public HTTP port. The supervisor must keep this read-only-HTTP / full-access-IPC split.
- **P2P port:** geth default is 30303. The current dev node does not run real P2P; a production node will. Confirm and fix the production P2P port when consensus lands.
- **Storage mode today:** `--gcmode archive` (devnet, to feed the explorer). **Production target is pruned, not archive** (see Section 8). Budget disk for whichever mode the supervisor launches.

## 4. Divi node spec (confirmed from the running node)

- **Binary (DD69 packaged):** `.../Library/Application Support/DD69/divid/unpacked/divid69`. A standalone build also exists at `/Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src/divid`.
- **Config:** `divi.conf`. Confirmed values: `rpcport=51473`, `rpcthreads=16`.
- **rpcthreads must never drop below 16.** Divi spawns one node thread per RPC connection; too few threads wedges the node. This is a hard floor.
- **P2P port:** Divi standard is 51472. Confirm against the live `divi.conf`/chainparams before relying on it.
- **Data:** initial sync via snapshot is about **4.7 GB** (snapshots.diviproject.org); with `addressindex` on (the explorer needs it) the on-disk size grows meaningfully beyond that.
- **Overlay:** OP_META records (603-byte script max), no SegWit. NFD/DMT/registry-root data rides in OP_META.
- **Shutdown is delicate:** the known crash is mid-flush at roughly 9 to 13 seconds. Always stop with **SIGTERM and wait**; give a generous timeout (30 to 60 seconds) before considering it stuck; **never SIGKILL/-9**, which corrupts state.

## 5. Machine requirements

These are per-machine, for a box running BOTH nodes plus the scanner and supervisor. Numbers are labeled measured vs estimated. Treat estimates as starting points: DIVA's real footprint is unknown until it carries load, and both chains grow with adoption.

### Memory (RAM)
- Divi node: ~1.4 GB measured live; budget ~2 GB.
- DIVA node: light today; budget ~2 to 4 GB for a production node carrying real state (estimated).
- Overlay scanner + supervisor + headroom: ~1 to 2 GB.
- **Tiers:** minimum **8 GB** (comfortable for both nodes now), recommended **16 GB**, validator/always-on **16 to 32 GB**. 4 GB is possible only for a light, low-state early node and leaves little headroom.

### Disk
- Divi: snapshot ~4.7 GB, plus addressindex growth; budget ~10 to 30 GB and rising (measured base + estimated growth).
- DIVA: tiny now; a production node grows with usage; budget ~20 to 50 GB early (estimated).
- Overlay index: several GB.
- **SSD or NVMe strongly recommended.** The real long-term cost on both chains is random reads over state, which punishes spinning disks.
- **Tiers:** minimum **60 GB SSD**, recommended **120 GB+ NVMe**, validator **250 GB+ NVMe**.

### CPU
- At the 2 to 3 second block target with a 30M gas limit, commodity CPU is fine. This is deliberate: DIVA is not chasing sub-second blocks, so it does not need datacenter hardware or a latency race.
- **Tiers:** minimum 2 cores (tight; each node and the scanner want a core), recommended 4, validator 4 to 8. More cores help once DIVA turns on parallel EVM execution under load.

### Network
- Always-on and publicly reachable is required for a real (non-dev) node, and mandatory for a validator (downtime costs rewards and can jail a validator).
- Bandwidth is modest at 2 to 3 second blocks. A typical VPS or a reliable home connection is enough for a full node; a validator should prefer an always-on VPS over a home connection for uptime reasons, not power.
- Inbound P2P must be reachable (open port or port-forward): Divi P2P (51472, confirm) and DIVA P2P (30303 default, confirm).

## 6. Supervisor responsibilities

1. **Lifecycle.** Start each node with the correct binary, data dir, and flags. Detect readiness by polling RPC (Divi: `getblockcount` responds; DIVA: `eth_blockNumber` responds), not by assuming a fixed delay. Restart on unexpected exit with backoff.
2. **Graceful shutdown.** Divi: SIGTERM, wait 30 to 60 s, never -9. DIVA/geth: SIGTERM/SIGINT, allow flush. Shut down cleanly on supervisor stop so neither node is killed mid-flush.
3. **Health/liveness.** Per node: RPC responsive, block height advancing (not stuck), peer count sane (once P2P is live). Surface a clear per-node status.
4. **Resource monitoring.** Track RAM, disk, and CPU. Warn on low disk well before full (a node that runs out of disk corrupts or halts). Emit these as events the UI can show, not as blocking prompts.
5. **Config management.** Own `divi.conf` (keep `rpcthreads>=16`) and the DIVA genesis/flags (chain id 1838). Keep the DIVA read-only-HTTP / full-access-IPC split intact.
6. **On-demand block behavior.** Preserve DIVA on-demand production (no empty blocks). If a slow heartbeat block is ever wanted, align it to the checkpoint cadence rather than producing constant empty blocks.

## 7. Bridge, checkpoint, and overlay hooks (build the seams, not the trust yet)

The supervisor is where the two chains meet. These hooks should exist as clean seams even though the decentralized versions are gated on POAS.

- **Overlay scanner.** The `dvxp-scan` overlay reader exposes a read-only API on `127.0.0.1:8710` (amounts are strings; check the `trustworthy` flag; this is overlay data, not raw Divi balances). The supervisor starts and monitors it alongside Divi.
- **Registry roots (NFD ownership snapshots).** The frozen Divi-side format is `/Users/geoffreymccabe/Divi-Blockchain_6.9/docs/NFD-REGISTRY-ROOT.md` (chain repo commit `d03f6c172`): SHA-256, RFC 6962 tree, hourly by block-height modulus (default 60 blocks), an 81-byte signed header (tag, epoch, height, leaf count, root). Producing the root and the header bytes to sign is done on the Divi side. **Publishing a root and deciding who signs it is DIVA-side work and is not built.** Leave a seam for it.
- **Checkpointing.** The design is a per-Divi-block signed write of the DIVA tip hash into Divi OP_META (the DD69 supervisor already writes OP_META for other overlay data). Not built. Leave a seam.
- **Honest trust note.** Until POAS exists, any signed root or checkpoint is only as trustworthy as the single key that signs it, which is no better than a coordinator signature. Build the shape; the decentralized signer swaps in when POAS lands.

## 8. What is REAL today vs a DESIGN TARGET

**Real today (confirmed on the machine):**
- DIVA is a BSC/geth fork, chain id 1838, 30M gas limit, modern EVM forks on, on-demand blocks (verified).
- DIVA currently runs in **dev/clique mode**, single node, `--gcmode archive`, read-only HTTP on `127.0.0.1:8548` plus full-access IPC. This is a devnet, not production.
- Divi node: `rpcport=51473`, `rpcthreads=16`, ~1.4 GB live, SIGTERM-only shutdown.

**Design target (NOT locked, do not hardcode as final):**
- Block time about **2 to 3 seconds** on commodity hardware (chosen to avoid a hardware arms race). Not yet locked.
- **Pruned** production nodes, not archive. Archive is only for the current explorer devnet.
- **POAS consensus** (BSC/Parlia): authority tier plus open staked validators, up to **38** active, **1,000,000 Divi** bond, slashing. Not built. Today's dev/clique mode is a placeholder for it.
- Per-epoch **registry-root publishing** and **checkpointing** into Divi, POAS-signed. Not built.
- Validator rewards scale with verifiable output and reliability, not raw speed. Design only.

## 9. Confirm-from-source checklist (before relying on these)

1. Divi P2P port (assumed 51472) from the live `divi.conf`/chainparams.
2. Production DIVA flags: the launch command will change from `--dev` to Parlia/POAS with a pruned store and a real P2P port. Those flags do not exist yet.
3. Exact production data-dir locations for a packaged (DD69) deployment vs the standalone dev tree.
4. Whether the packaged `divid69` and the standalone `/Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src/divid` should be the same binary in production (today both exist).

---

### One-paragraph summary

Build one supervisor that runs the Divi daemon (`divid69`, RPC 51473, rpcthreads at least 16, SIGTERM-only shutdown, about 1.4 GB) and the DIVA geth node (BSC fork, chain id 1838, 30M gas, on-demand blocks, read-only HTTP on 8548 plus full-access IPC) side by side, with the overlay scanner on 127.0.0.1:8710. Plan a machine with 8 to 16 GB RAM, 60 to 120 GB of SSD/NVMe, and 2 to 4 cores for a normal node; more for a validator. Today DIVA runs in dev mode, so build the process management for real now and leave clean seams for POAS consensus, registry-root publishing, and checkpointing, none of which are built yet. Treat the 2 to 3 second block time, pruning, and the 38-validator POAS model as targets, not settled facts.
