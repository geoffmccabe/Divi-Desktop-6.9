# Divi Vaults - branch handoff (`divi-vaults`)

For the agent adding "extra wallets to a node." This branch adds a working
on-chain Divi vault feature. Merge it into the wallets-feature work.

Branch: `divi-vaults`. Base commit: 6c4fb18 (main tip at 2026-09-27).
Built in an isolated git worktree so it never touched the shared main tree.
NOT built or run locally (local builds are disabled); the cloud pipeline
(build-apps.yml) compiles it. TypeScript was type-checked; Rust was not
compiled locally, so expect to compile-check on first cloud build.

## What a vault is (from the daemon, confirmed by reading Divi-Blockchain_6.9)

A vault has two keys:
- OWNER: keeps custody, can reclaim/spend. This is the user's (extra) wallet.
- MANAGER: may stake the coins but can never spend them. This is the MAIN NODE.

So "an extra wallet vaults to the main node so it can stake" = the extra wallet
funds a vault with owner = its own address, manager = the main node's staking
address. The main node stakes it; the owner reclaims anytime.

Daemon RPCs used (all already present in divid69):
- `fundvault "owner:manager" amount` -> fund a vault.
- `reclaimvaultfunds destination amount` -> owner withdraws.
- `getcoinavailability` -> "Vaulted" total (how much the wallet has in vaults).
- `getaccountaddress ""` -> the node's stable owned address (default manager).

## Files in this branch

New:
- crates/supervisor/src/vault.rs - fund_vault, reclaim_vault_funds,
  vaulted_balance, manager_address.
- ui/src/wallet/VaultsPanel.tsx - the panel (Self-Custody + Custodial tabs).
- ui/src/wallet/vaults.css - panel styles (matches Overview/History).
- ui/src/wallet/vaultFee.ts - the fee "in-between step", FREE now (see below).
- docs/DIVI-VAULTS-SERVICE-PLAN.md - the full plan.
- docs/DIVI-VAULTS-BRANCH-HANDOFF.md - this file.

Changed:
- crates/supervisor/src/lib.rs - added `pub mod vault;`.
- crates/app/src/main.rs - added `vault` to the use list, four Tauri commands
  (vault_fund, vault_reclaim, vault_balance, vault_manager_address), and
  registered them in the generate_handler list.
- ui/src/wallet/api.ts - added vaultFund, vaultReclaim, vaultBalance,
  vaultManagerAddress bindings.
- ui/src/nav.ts - "Vaults" item under "Transaction History".
- ui/src/Shell.tsx - registered the vaults view.

## The manager-address handshake (my decision, adapt as needed)

An extra wallet needs to know WHAT to vault to. The command
`vault_manager_address` returns the main node's stable account address
(getaccountaddress ""), which is the staking identity by default.

When the wallets feature introduces an explicit "main wallet" concept, point
`vault::manager_address` (crates/supervisor/src/vault.rs) at that wallet's
staking address instead. Nothing else in the flow changes: deposit still calls
fundvault with owner = the extra wallet's address and manager = whatever this
returns.

## The fee "in-between step" (currently FREE)

ui/src/wallet/vaultFee.ts. FEE_ENABLED is false, so every fee is 0 and the panel
shows "Free during launch". To switch on a monthly fee later: set FEE_ENABLED =
true and replace ASSUMED_ANNUAL_REWARD_RATE with the real measured average. It
then quotes a flat monthly fee = 10% of the reward the vaulted amount is expected
to earn, shown up front in DIVI.

## Money-safety / unlock

vault_fund and vault_reclaim MOVE money and require the wallet unlocked, exactly
like Send. This code never takes a passphrase. If the node is locked it returns
an error, which the panel shows with a hint to unlock via the existing flow. If
you want an inline unlock, reuse the existing unlock_wallet / PasswordPanel flow;
do not add a new passphrase field.

## Reusable API for side wallets and HRAs

The vault primitive is a plain, public Rust module (crates/supervisor/src/vault.rs)
plus matching Tauri commands / TS bindings. Other features call these directly;
they do NOT need to touch the panel.

Rust (crate dd69_supervisor::vault), each taking `&NodeConfig`:
- fund_vault(owner_address, manager_address, amount) -> txid
- reclaim_vault_funds(destination, amount) -> txid  (across all the wallet's vaults)
- debit_vault_by_name(vault_encoding, destination, amount) -> txid  (one vault)
- list_vaults() -> Vec<(encoding, amount)>
- vaulted_balance() -> total DIVI in vaults
- manager_address() -> the main node's staking address (the handshake)

Tauri commands (for UI): vault_fund, vault_reclaim, vault_debit, vault_list,
vault_balance, vault_manager_address.
TS bindings (ui/src/wallet/api.ts): vaultFund, vaultReclaim, vaultDebit,
vaultList, vaultBalance, vaultManagerAddress.

Typical use by a SIDE WALLET: read manager via manager_address(), then
fund_vault(sideWalletAddress, manager, amount). To reclaim that side wallet's
specific vault, use debit_vault_by_name(its "owner:manager", destination, amount).
HRAs can use the same calls (owner = the HRA-linked address).

## Known limitations / TODO on merge

- Deposit uses a fresh owned address (newReceiveAddress) as the vault owner. In
  the multi-wallet model, set the owner to the specific extra wallet's address.
- "Vault payments" history is a placeholder: vault staking rewards currently show
  in the normal Transaction History as stakes. A dedicated vault-reward feed
  would need the backend to tag them.
- The sidebar icon reuses the existing "multisig" icon (no new asset). Swap for a
  dedicated vault icon if desired.
- Rust not compiled locally; verify on first cloud build.
