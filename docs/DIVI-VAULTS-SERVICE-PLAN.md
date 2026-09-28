# Divi Vaults Panel (Self-Custody + Custodial) inside DD69

Status: FULLY WIRED on branch `divi-vaults` (deposit/withdraw/balance live).
Author: Geoff + Claude. Updated: 2026-09-27.
See docs/DIVI-VAULTS-BRANCH-HANDOFF.md for the merge guide.

Built so far (type-checks clean, no money moves):
- /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/VaultsPanel.tsx (two tabs,
  Self-Custody default + Custodial, styled like Overview/History).
- /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/vaults.css.
- /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/vaultFee.ts (the fee
  "in-between step": FREE now via FEE_ENABLED=false; flip it on and supply the
  real measured reward rate to bill 10% of expected reward as a monthly fee).
- nav.ts: "Vaults" item added directly under "Transaction History".
- Shell.tsx: registered the vaults view.
Deposit/Withdraw and the DiviGo setup button are present but disabled ("coming
soon"). The DiviGo Telegram handle constant (DIVIGO_TELEGRAM) is blank pending
the real value.

## 1. What we are building (plain English)

A "Vaults" panel in the Divi Desktop 6.9 wallet, added as a new left-sidebar item
directly under "Transaction History", plus a "Vault with me" button under the
staking dropdown in the top middle of the app.

The panel has TWO TABS:

- **Self-Custody (DEFAULT / primary tab).** The real on-chain Divi vault. The
  user keeps custody of their coins; they only delegate the right to STAKE (never
  to spend) to Geoff's main node in Fasthosts (UK). Coins stay staking 24/7 even
  with the user's machine off. The user earns their own on-chain vault rewards.
  Because this is non-custodial and not pooled, it CANNOT offer pooled daily
  shares or a collective lottery split, and the tab must not mention or imply
  those. Only show what on-chain vaulting can actually deliver.

- **Custodial (secondary tab).** Explains vaulting with DiviGo (custodial, run in
  Telegram), invites the user to move their $DIVI to DiviGo, and offers a one-tap
  way to set it up. Setting it up here also links their new DiviGo wallet into the
  app. DiviGo is where the pooled daily shares and collective lottery live; that
  is DiviGo's own offering, not a new engine we build in DD69.

Default tab = Self-Custody. Custodial is secondary.

The Self-Custody tab shows:
- the user's spendable coins (wallet balance),
- how much of theirs is currently in vaults,
- a Deposit-to-vaults control,
- a Withdraw-from-vaults control,
- a history of all their vault payments (rewards), newest on top.

Styling matches the Overview and Transaction History screens.

## 2. Important finding: there is no built DiviGo panel yet

A full search of the UI found NO dedicated DiviGo panel. DiviGo currently appears
only as placeholders for a future link:
- /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/ReceivePanel.tsx
  ("Available once your wallet is linked to DiviGo", "Telegram coming with DiviGo")
- /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/PasswordPanel.tsx
  ("Email / DiviGo two-factor is planned")

So the "connect to DiviGo and it lights up elsewhere in the app" idea is right,
but the DiviGo-link plumbing does not exist yet. The Custodial tab's connect flow
is where we CREATE that link; the existing placeholders become the things that
light up once the link exists.

## 3. Feasibility

### Phase 0 CONFIRMED (2026-09-27): the daemon fully supports vaults.
Verified by reading /Users/geoffreymccabe/Divi-Blockchain_6.9/divi/src
(rpcwallet.cpp, rpcserver.cpp, VaultManager.cpp). The vault commands exist:
- `fundvault "[owner_address:]manager_address" amount` - create/fund a vault.
- `reclaimvaultfunds destination amount` - owner withdraws from their vaults.
- `debitvaultbyname "owner:manager" destination amount` - withdraw from one vault.
- `removevault "owner:manager"` - manager stops staking a given vault.

The vault model = two keys:
- OWNER address: keeps custody, can reclaim/spend. This is the user's extra wallet.
- MANAGER address: may stake but never spend. This is the MAIN NODE's staking
  address.

So "extra wallets vault to the main node so they can stake" is exactly:
  extra wallet funds a vault with owner = its own address, manager = the main
  node's staking address; the main node stakes it; the owner reclaims anytime.

Backend written so far: /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/vault.rs
(fund_vault + reclaim_vault_funds wrappers, isolated new file, not yet wired).

Remaining to make it fully work (see Section 9).

- Self-Custody: buildable and CONFIRMED (above).
- Custodial: buildable. It is mostly an explainer plus an onboarding link into
  DiviGo (Telegram) and a wallet-link record. DiviGo already runs the pooled
  staking + daily payout economics; we do not rebuild that here.

## 4. Pieces we already have (reuse, do not rebuild)

- **Panel plumbing:** a view is one entry in
  /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/nav.ts plus one line in
  /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/Shell.tsx (the VIEWS map). Place
  the new nav item directly under the "history" (Transaction History) entry.
  Template panel to copy: /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/TokensPanel.tsx.
- **Look/feel to match:** /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/Overview.tsx
  and /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/ActivityList.tsx
  (newest-on-top list). Shared styles in
  /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/index.css.
- **Staking dropdown (for the button):**
  /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/StakingDropdown.tsx.
- **Wallet balance / coin data (backend):**
  /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/wallet.rs
  (listunspent, listtransactions, getstakingstatus); coin maturity in
  /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/maturity.rs.
- **DiviGo placeholders to wire up later:** ReceivePanel.tsx and PasswordPanel.tsx
  (Section 2).

## 5. How each tab works

### Self-Custody (on-chain vault, non-custodial)
1. Deposit to vault: user moves their own coins into an on-chain vault output that
   delegates staking to our Fasthosts node's staking key (owner key stays with the
   user; the node can stake but never spend).
2. Staking: our node keeps the vault staking 24/7.
3. Rewards: on-chain vault rewards accrue to the user's own vault. These appear in
   the panel's payment history, newest on top.
4. Withdraw from vault: user reclaims (spends back to themselves) using their owner
   key. May wait briefly if coins are in immature staking outputs (coin maturity).
5. No pool, so no daily pooled share and no collective lottery. Do not mention them.

### Custodial (DiviGo doorway)
1. Explainer: what DiviGo vaulting is and its benefits (DiviGo's offering).
2. One-tap setup: open/link DiviGo in Telegram, create/link the user's DiviGo
   wallet, and record the link in the app.
3. Once linked, the app's DiviGo placeholders (ReceivePanel, PasswordPanel, and a
   future DiviGo balance view) light up as connected.

## 6. Build phases

### Phase 0 - Confirm the on-chain vault daemon support (no UI)
- Verify divid69 answers the on-chain vault (cold-staking) commands on Geoff's node.
- Decide the staking-delegation address scheme (our node's staking key).
- If unsupported, stop and reassess before building the Self-Custody UI.

### Phase 1 - Vaults panel shell + Self-Custody read-only (safe, no money moves)
- New file: /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/VaultsPanel.tsx
  (copy TokensPanel.tsx as the skeleton; two tabs, default Self-Custody; style
  from Overview/ActivityList).
- Add nav item in ui/src/nav.ts directly under the "history" entry, e.g.
  { id: "vaults", label: "Vaults", icon: "..." }.
- Register in ui/src/Shell.tsx VIEWS map: vaults: VaultsPanel.
- Self-Custody tab shows: wallet coins, amount in vaults, reward history
  newest-on-top. Deposit/Withdraw visible but disabled ("coming soon").
- Deliverable: user can see their vault position and history.

### Phase 2 - Self-Custody Deposit
- Deposit control creates the on-chain vault output delegating staking to our node.
- Confirmation + clear pending state; minimum deposit guardrail.

### Phase 3 - Self-Custody Withdraw
- Withdraw control reclaims coins to the user's own address using their owner key.
- Warn about coin maturity delay; reuse
  /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/maturity.rs.
- Guardrails: minimum, confirmation step.

### Phase 4 - Custodial tab (DiviGo doorway) + DiviGo link
- Build the Custodial tab: explainer + one-tap DiviGo Telegram onboarding.
- Build the DiviGo wallet-link record and light up the existing placeholders
  (ReceivePanel.tsx, PasswordPanel.tsx).

### Phase 5 - The staking-dropdown button + polish
- Add "Vault with me" button in
  /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/StakingDropdown.tsx that
  opens the Vaults panel.
- Transparency, limits, monitoring.

## 7. Open questions for Geoff
- OK to confirm divid69 vault support first (Phase 0)? (Assumed yes.)
- Monetization of Self-Custody: on-chain vaults pay the user directly, so there is
  no automatic operator cut. Is Self-Custody a free feature (DiviGo is the paid
  path), or do you want a fee mechanism on it?
- "Underneath Transaction History" = new sidebar item directly below the
  Transaction History nav item? (Assumed yes.)
- Custodial connect: how should the DiviGo link be created (Telegram deep link +
  SSO), and what does "linked" unlock in the app first?
- Minimums for deposit and withdrawal (Self-Custody).

## 9. What remains to make vaults fully work

Backend logic exists in crates/supervisor/src/vault.rs. To connect it end to end:

1. Register the module: add `pub mod vault;` to
   /Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/lib.rs.
2. Add Tauri commands in
   /Users/geoffreymccabe/Divi-Desktop-6.9/crates/app/src/main.rs:
   vault_fund(owner, manager, amount), vault_reclaim(destination, amount), and a
   vault_balance read. These require the wallet to be unlocked first, reusing the
   SAME unlock flow staking already uses (we never handle the passphrase).
3. Add TS bindings in
   /Users/geoffreymccabe/Divi-Desktop-6.9/ui/src/wallet/api.ts.
4. Wire the Deposit/Withdraw buttons in VaultsPanel.tsx to those bindings and
   show the vaulted balance.

TWO OPEN ITEMS:
- Manager address contract (shared with the multi-wallet feature): where does the
  MAIN NODE's staking/manager address come from, so an extra wallet knows what to
  vault to? This must be agreed with the agent building extra-wallets-per-node.
- Reading the owner's vaulted total ("In vaults"): confirm the exact daemon read
  (likely listunspent filtered to vault outputs, or a getbalance variant). Not yet
  wired, so the panel shows 0 for now.

COORDINATION HAZARD: main.rs, lib.rs and api.ts are all being edited by another
agent right now. Committing them would also commit that agent's unfinished work,
which we must never do. Either coordinate/wait for them to commit, or stage only
our own hunks surgically (as was done for index.css previously).

## 8. Notes / risks
- No local builds on the dev Mac; ship via the cloud build pipeline
  (build-apps.yml). Frontend changes need a cargo rebuild to re-embed the UI.
- Shared working tree: create new files, never `git add -A`; commit only our own
  explicit paths.
