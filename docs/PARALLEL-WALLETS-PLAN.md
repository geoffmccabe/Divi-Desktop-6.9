# Parallel wallets: extra wallets beside the staking wallet

Written 2026-Sep-27 from Geoff's request. Defaults below were chosen where
he had not yet answered; each is one line to change.

## What is asked for

Settings > My Nodes: a **+WALLET** button at the bottom right of each node
panel. "Create a new Wallet?" with Confirm / Cancel. On confirm, two panels
appear under the node, indented 100 px: **Staking Wallet** first (always),
then the new wallet; up to 20 wallets per node. Each panel shows its
address, can make more child addresses and name them (as My Addresses
does), and has an HRA slot: the human-readable address in **bold gold** when
one is assigned; otherwise "No HRA - Human Readable Address yet" with a
**Get HRA** button that opens the HRA tab pre-filled with the address, so a
purchased name lands in that wallet. Every generated address has a **vault
staking** checkbox, on by default, so its coins are staked by the node's
main staking address.

## Facts the design rests on (read from the node source)

- The node holds ONE wallet file, and everything in it stakes. A wallet
  whose coins do not stake by themselves is therefore outside that file.
- The node derives keys along `m/44'/301'/account'/change/index` from its
  HD seed (`hdchain.cpp`), and uses account 0. `dumphdinfo` gives the seed
  (wallet must be unlocked).
- `signrawtransaction` accepts private keys as a parameter: the node can
  sign with keys handed to it for one call and never stores them.
- The address index reports balance and coins for ANY address
  (`getaddressbalance`, `getaddressutxos`).
- Vaults exist in the node since 2020: `fundvault "owner:manager" amount`,
  `addvault`, `removevault`, `reclaimvaultfunds`, `debitvaultbyname`. The
  owner keeps the coins; the manager (the node) only stakes them.
- Divi Names (`names.rs`): `register`, `buy`, `transfer(name, new_owner)`,
  `my_names`, each name points at a Divi address and is owned by one.
- What the other agent built in July (`divi-core-rpcs`, "light staking
  node": `getstaketemplate`/`submitstakeblock`) is external block-building
  for phones, not vaults, and is not in our node branch. It does not
  collide with this plan.

## Design (Geoff's answers, 2026-Sep-27)

1. **Keys: each wallet has its own 12-word seed**, made by the app, shown
   once for backup, restorable in any Divi wallet (standard path
   `m/44'/301'/0'/0/i`). The app stores the seed encrypted in its data
   folder (`wallets.json`): by default under a random key kept in the
   operating system's keychain (no extra password to remember); optionally
   under a password the user sets for that wallet.
2. **Purpose:** separate pots (coins held for children, a game pool, a
   savings account). Separate password optional, off by default.
3. **Sending and receiving:** the main Send and Receive screens get a
   "which wallet" choice, defaulting to the node's own (staking) wallet.
   Each wallet panel also has its own Receive and Send.
4. **Vault staking:** per address, default on. Coins in a vault owned by a
   wallet's key are that wallet's coins, and stake rewards are paid into the
   vault itself, so they show in that wallet with no sending at all. Where a
   LOTTERY win on a vault-staked block is paid is to be verified in the node
   code before it is promised.
5. **Limit:** 20 per node.
6. **HRA:** a name can be bought for any address. The HRA tab will say
   plainly when the address that pays is not the address the name will
   point at, and suggest buying from the target address, since most people
   will want the name and its token in the same wallet. Moving an existing
   name into a wallet uses `transfer`.
7. **Header total includes every wallet.** With more than one wallet, a
   dropdown to the right of the word DIVI opens a panel listing each wallet
   with its DIVI and US-dollar value, as multi-account Solana wallets do.
8. **Names of addresses** (white) are local labels, stored by the app.

## Phases

### Phase 0. Foundation (no UI). The riskiest part; it holds money.
- `crates/supervisor/src/wallets.rs`: make a seed (12 words, BIP 39),
  derive keys (BIP 32 with the `secp256k1` crate, verified on crates.io
  before use), addresses (base58, P2PKH, prefix as the node); a store of
  wallets, encrypted seeds, labels and flags under the app's data folder
  (`wallets.json`); the keychain-held default key; optional per-wallet
  password.
- Balance and coins per address through the address index.
- Sending from a wallet: build with `createrawtransaction`, sign with
  `signrawtransaction` + the derived key, broadcast. Fees as the node does.
- Tests: derivation against a known vector (a derived address must equal
  what the node itself derives for that path: prove it by importing the
  derived key into a regtest node and comparing `getaddressesbyaccount`);
  send on regtest end to end.
- Done when: a regtest node has a second wallet with coins received, seen,
  and sent, with the node's wallet file untouched.

### Phase 1. UI: My Nodes panels
- +WALLET button, confirm modal, Staking Wallet panel + indented wallet
  panels, address list with names, "New address", 20 cap.
- Receive and Send inside each wallet panel.
- Done when: Geoff creates a wallet, receives to it, sends from it.

### Phase 2. Vault staking (only after tying into what exists)
- Node: one RPC to build the reclaim spend for an external owner (the vault
  script is P2SH; the owner's key is not in the node wallet). Everything
  else exists (`fundvault`, `addvault`, `getaddressutxos` on the vault).
- App: the checkbox per address; "Stake these" funding; showing vaulted vs
  plain balance; reclaim.
- Done when: coins in a wallet's vault earn a stake reward on the private
  chain and are reclaimed by the owner.
- **Guard:** before writing any vault code, re-read what the vault agent has
  in flight and build on it, not beside it.

### Phase 3. HRA in the wallet
- HRA slot (gold / white), Get HRA opens the HRA tab pre-filled with the
  address, purchase lands the name at that address; move an existing name
  into a wallet.
- Done when: a name bought from a wallet shows in gold in that wallet.

### Phase 4. Safety and polish
- "Show words" per wallet (the same words), restore on a fresh install
  finds the wallets again (names re-entered), address book entries, the
  activity list per wallet, hard limits and plain errors.

## Risks
- Deriving a key wrongly loses money. Phase 0's test against the node's own
  derivation is not optional.
- The node wallet must be unlocked to derive: every extra-wallet action
  asks for the password as Send does today.
- Vault reclaim for an external owner needs node work; do not ship the
  checkbox before reclaim works.
