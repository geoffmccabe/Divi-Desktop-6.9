# DIVA 2-Node Launch Plan

**Status:** Executable plan. This stands up the first real multi-node DIVA network: two always-on servers producing blocks together, with Geoff's laptop joining as a non-producing node. This is the seed that everyone else joins later.
**Date:** 2026-Oct-29
**Audience:** the agent or engineer standing up the network. Follow this in order. Section 0 is a must-verify-first; do not skip it.

**One-line goal:** turn DIVA from a single fake-it dev node into a genuine small network of separate machines that agree on blocks, so we can then add features by coordinated hard-fork.

---

## 0. Verify first (the one real unknown)

Today DIVA runs in geth **dev mode** (`--dev --dev.period 0`): one machine, one key, real peer-to-peer networking OFF. That mode cannot have a second node join it. To get a true multi-node network we switch to a proper authority mode. For this first launch we use **clique** (geth's simple proof-of-authority: a fixed list of signers take turns making blocks, no complex system contracts needed). Clique is the fast, real path. The full POAS/Parlia staking economics (bond, jackpot rewards, open validator set) are a separate later phase (Section 7), because Parlia is tightly coupled to BSC's system contracts and is much heavier to stand up.

**Must verify before anything else:** confirm the binary at `/Users/geoffreymccabe/diva/bsc/build/bin/geth` actually supports **multi-signer clique** (not just `--dev`). It is a fork of `bnb-chain/bsc`, which is Parlia-focused, so clique may or may not be fully wired in that build.

- If clique multi-signer works in the fork binary: proceed with this plan as written.
- If it does not: two fallbacks, in order of preference. (a) Stand up a minimal **Parlia** validator set of 2 instead (more setup: needs the BSC validator-set system contract seeded in genesis), or (b) run the 2-node proof-of-authority network on a stock upstream `go-ethereum` geth for the launch, keeping the BSC fork for when POAS lands. Pick (a) if we want to stay on our own binary; pick (b) if we want the network live fastest and are willing to swap binaries at the POAS hard-fork.

Confidence: I expect clique is present (today's dev mode is PoA-style and the node/supervisor spec refers to "dev/clique mode"), but I have not confirmed the multi-signer clique path in this specific build. Verify, then proceed.

## 1. What we are launching (decisions for this phase)

- **Consensus for launch:** clique proof-of-authority, **2 signers** = the two always-on servers (Europe + UK). Simple, real, no system contracts.
- **Chain id:** 1838 (unchanged). **Gas limit:** 30,000,000 (unchanged). **EVM forks:** modern set already in genesis (Shanghai/Cancun/Prague: EIP-7702 smart accounts, the RIP-7212 passkey precompile, etc.). Keep them.
- **This is a fresh chain.** A new genesis means a new network from block 0. The current dev-mode devnet state does NOT carry over, and the scan.divi.love explorer will need re-pointing at the new network (Section 6). That is fine: the devnet was always a throwaway.
- **Block timing changes.** Clique produces a block every fixed `period` seconds, including small empty ones (it does not do the dev-mode "only when there's a transaction" trick). So we pick a heartbeat. Recommended: a modest period and **pruned** producers, not archive. See Section 3 for the tradeoff.

## 2. The three machines and their roles

| Machine | Role | Always-on? | Public P2P reachable? |
|---|---|---|---|
| VPS #1 (Europe) | **Signer** (block producer) | Yes, required | Yes, required |
| VPS #2 (UK) | **Signer** (block producer) | Yes, required | Yes, required |
| Geoff's laptop + DD69 | **Full node** (joins, syncs, runs the wallet), NOT a signer | No, comes and goes | No, dials out only |

Why the laptop is not a signer: a signer that disappears when the laptop closes would stall its turn and weaken the chain. As a plain full node the laptop just syncs when it is open, runs the wallet, and nobody waits on it. It only needs to make outbound connections, so there is no port to open on the home network.

## 3. Block period and storage (pick before writing genesis)

- **Period:** clique mints a block every `period` seconds whether or not there are transactions. Shorter = snappier but more empty blocks and faster disk growth. The design target elsewhere is 2 to 3 seconds. For a brand-new chain with pruning not yet tuned, a slightly longer heartbeat (for example 5 to 15 seconds) keeps the chain small early while still feeling live. Recommended: start around 10 seconds, with the option to shorten once pruning is confirmed healthy. This is a parameter, set it where we are comfortable.
- **Storage mode:** run the signers **pruned** (not `--gcmode archive`). Archive was only for feeding the explorer on the dev node and will bloat fast with a steady block heartbeat. If the explorer needs archive data, run ONE separate archive node for it rather than making the producers archive.

## 4. Stand-up steps (in order)

1. **Prep each VPS.** Install the geth binary. Open the firewall for the P2P port only (geth default **30303**, TCP and UDP). Do NOT expose the RPC port publicly; RPC stays bound to localhost, transaction sending stays on the local IPC socket (keep the read-only-HTTP / full-access-IPC split from the node spec).
2. **Create one signer key per VPS.** Each server gets its own new account = its signer identity. Back up each keystore file and its password somewhere safe and offline. Losing a signer key means losing that producer.
3. **Write the shared genesis file.** One genesis, identical on all machines: chain id 1838, the clique section (the chosen period and the epoch length), the two signer addresses encoded in the genesis `extraData` as clique requires, the gas limit, the modern fork settings, and the initial balance allocations (pre-fund the treasury/bridge account and any founder accounts here, since there is no mining subsidy in clique). Save it as the canonical genesis (for example `/Users/geoffreymccabe/diva/genesis/diva-clique-genesis.json`) and copy it byte-for-byte to every machine.
4. **Initialize every node** from that exact genesis file (geth `init`). All three machines (both VPS and the laptop) must init from the identical file or they will refuse to peer.
5. **Wire them together.** Take VPS #1's node identity (its enode URL) and give it to VPS #2 and the laptop as a static peer / bootnode, and vice-versa, so they reliably find each other instead of relying on public discovery. Start the two VPS nodes and confirm each shows a peer count of at least 1 and that they are connected to each other.
6. **Turn on block production on the two VPS only.** Unlock each signer account and start it producing (clique signing, with that node's signer as the block-reward recipient). Confirm blocks are advancing AND that authorship alternates between the two signer addresses (not all from one). Alternating authorship is the proof that it is really a 2-signer network and not one node pretending.
7. **Bring the laptop in as a full node.** Same genesis, dials the two VPS as peers, syncs to the tip, runs the wallet. Confirm it can go offline and come back and catch up without disturbing the producers.
8. **Re-point the explorer** at the new network (Section 6).
9. **Lock in operations** (Section 5).

## 5. Operating the network

- **Always-on.** Both VPS run as managed services that restart on crash and on reboot. Downtime on a signer stalls that signer's turns.
- **Graceful shutdown.** geth: SIGTERM/SIGINT and allow flush time; never hard-kill mid-write. (The Divi node on the same box, if present, is SIGTERM-only, never `-9`, with a generous wait: that rule is unchanged.)
- **Monitoring.** Watch per node: RPC responsive, block height advancing (not stuck), peer count sane, disk headroom (a node that fills its disk corrupts or halts). The supervisor described in `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-NODE-AND-SUPERVISOR-SPEC.md` is the eventual home for all of this; it is not required to stand the network up, but it is the right place to grow into.
- **Backups.** Keystores and the genesis file, off the servers.

## 6. The explorer

scan.divi.love's DIVA side is fragile and points at an ephemeral tunnel origin (see the DIVA memory note and `/Users/geoffreymccabe/diva/PLAN.md`). When the new network goes live it is a different chain from the current dev node, so the explorer must be re-pointed at it. Prefer fixing this properly now: one always-on node (an archive node if the explorer needs full history), a named stable tunnel, and the origin as a secret rather than a hardcoded ephemeral URL.

## 7. The honest limits of a 2-node launch, and what comes next

- **Two signers has no fault tolerance.** If one VPS goes down, security and liveness degrade immediately (with only two authorities there is no honest majority to fall back on). Treat 2 as the bootstrap, not the destination. **The single most valuable next step is getting to 3 or 4 always-on signers** (your friends on their own servers). Going from 2 to about 4 is a bigger robustness jump than anything else on the roadmap.
- **Adding a signer** in clique is a vote by the existing signers plus that machine initializing from the same genesis and peering in. Easy to coordinate while the set is small and known.
- **Adding features = coordinated hard-fork.** To ship a new capability, every operator upgrades to the new binary (and any new genesis/config settings) at an agreed block height. With a handful of known operators this is simple. This is exactly the "launch, then add features and hard-fork as needed" path.
- **This phase deliberately does NOT include:** the 3,000,000 Divi bond, staking, slashing, the hourly jackpot reward, or an open (permissionless) validator set. Those are the **POAS phase** (Section 8). Clique's reward model is trivial (just the per-block recipient); the real economics land with POAS.

## 8. Next phase: POAS + the hourly-jackpot reward (design, not this launch)

When we move from clique to full POAS (Parlia with the staking system contracts), the reward model to build is the hourly-jackpot design Geoff proposed, which is sound because of one key property: **the reward is real Divi earned by the locked bond staking on the Divi mainchain, not freshly printed on DIVA.** DIVA's native coin is bridged Divi backed 1-to-1, so DIVA must never mint new Divi as a reward (that would break the peg). Earning it on the mainchain sidesteps that entirely.

The model, to be specified in full later:

- To run a validator you bridge in a minimum bond (proposed **3,000,000 Divi**; a parameter). The DIVI locks on the Divi mainchain in bridge custody and appears as your bond on DIVA.
- That locked DIVI **stakes on the Divi mainchain** and earns real Divi staking rewards. This earned Divi is the reward pool. (Requires the bridge custody to actually run Divi staking/masternodes with the locked funds, and to secure that custody: real work, but it is the engine.)
- **Every hour, the pool is paid as one lump to a single winning validator,** chosen by weighted-random draw. More stake = proportionally bigger chance. Big exciting payout instead of tiny per-block dust.
- **The Divi weekly-lottery windfall rolls into the jackpot.** Divi's mainchain awards a periodic (roughly weekly) lottery block to a random staker. Because the bridge custody is staking a large bonded pile, it has a genuine chance of winning one. When it does, that windfall simply arrives in the custody as more Divi and becomes part of **that hour's** reward pool. So the operator who happens to win the DIVA hourly draw in the same hour the custody wins the Divi lottery hits a double jackpot: the normal hourly pot plus the whole lottery win. This is a free consequence of the design (no extra mechanism needed on the funding side), and it is the exciting "it could be huge this hour" hook. Decision recorded: the windfall goes to that hour's single winner (maximum thrill), rather than being spread across many hours. The spread-it alternative exists if we ever want to smooth payouts, but the chosen design is winner-takes-the-windfall. Note: the bigger the total bonded across all validators, the more often the custody wins the Divi lottery, so this gets more frequent as the network grows.

Design requirements carried over from this plan, to build in from the start:

1. **Un-riggable randomness.** The winner-picking randomness must not be nudgeable by the validators who stand to win. Use a commit-reveal scheme or a verifiable randomness source, not the chain's naive built-in randomness. This matters most on a lottery-windfall hour, when the pot is huge and the incentive to game the draw is highest.
2. **Hybrid, not pure lottery.** Pair the jackpot with a small steady base reward that covers an operator's server costs, so honest small operators are not bled out by variance while waiting to win.
3. **Eligibility gated on real work.** To be entered in the hour's draw, a validator must have been online and actually produced its blocks that hour. Among the eligible, then it is stake-weighted random. This ties the jackpot to uptime and output, matching the existing decision that rewards follow verifiable work, not just locked coins.

---

### One-paragraph summary

Launch a real network now by switching DIVA off single-node dev mode onto a 2-signer clique proof-of-authority network: two always-on servers (Europe + UK) produce blocks together from one shared genesis (chain id 1838), and Geoff's laptop joins as a plain full node that comes and goes. Verify the fork binary supports multi-signer clique first (Section 0); run the producers pruned, not archive; re-point the explorer at the new chain. Two signers is only the bootstrap: get to 3 or 4 always-on operators quickly, because that is the real robustness jump. Add features by coordinated hard-fork. The 3,000,000-Divi bond and the hourly-jackpot reward are the next (POAS) phase, and the jackpot is fundable without breaking the peg because the reward is real Divi the locked bond earns by staking on the Divi mainchain, paid hourly to one stake-weighted random winner, with un-riggable randomness, a small base reward, and eligibility gated on actual uptime. When the bonded pile wins Divi's roughly-weekly mainchain lottery, that windfall rolls into that hour's jackpot, so one lucky operator occasionally hits a double jackpot.
