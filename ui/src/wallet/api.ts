import { invoke } from "../tauri";

export interface Balance {
  spendable: number;
  staking: number;
  pending: number;
  immature: number;
}

export interface Tx {
  kind: string; // receive | send | stake | other
  amount: number;
  address: string;
  confirmations: number;
  txid: string;
  time: number;
}

export interface AddrInfo {
  address: string;
  isMain: boolean;
  receives: number;
  sends: number;
  stakes: number;
}

export interface Proof {
  matched: boolean;
  confirmations: number;
  block_time: number | null;
}

export interface StakeWallet {
  address: string;
  size: number;
  stakes: number;
  firstStake: number | null;
  lastStake: number | null;
}
export interface LotteryInfo {
  tip: number;
  nextHeight: number;
  nextEta: number; // unix seconds, estimated
}
export interface LotteryWin {
  address: string;
  big: number;
  small: number;
}

export const walletBalance = () => invoke<Balance | null>("wallet_balance");
// `fee` is left to the staker; `payoutDivi` goes to `payoutAddr`. Nulls fall
// back to the node-side minimum, so a missing price quote can never overspend.
export const poeTimestamp = (
  hash: string,
  fee?: number | null,
  payoutAddr?: string | null,
  payoutDivi?: number | null,
  passphrase?: string | null,
) =>
  invoke<string>("poe_timestamp", {
    hash,
    fee: fee ?? null,
    payoutAddr: payoutAddr?.trim() || null,
    payoutDivi: payoutDivi ?? null,
    passphrase: passphrase || null,
  });
export const poeVerify = (txid: string, hash: string) => invoke<Proof>("poe_verify", { txid, hash });

// ---- Divi Meta Tokens ----
//
// `from` is not optional in spirit on any of these. A record's author is the
// address that funds the transaction, so the caller must pass the address that
// actually holds the tokens. Funding from anywhere else produces a record that
// is mined, costs a fee, and is then ignored, with nothing shown to the user.
//
// Amounts are STRINGS in the token's smallest unit, never numbers. A token with
// 8 decimals and a large supply exceeds what a JavaScript number represents
// exactly, and rounding somebody's balance in transit is not acceptable.

export const tokenCreate = (from: string, premine: string, decimals: number, fee?: number) =>
  invoke<string>("token_create", { from, premine, decimals, fee });

export const tokenSend = (from: string, token: string, amount: string, to: string, fee?: number) =>
  invoke<string>("token_send", { from, token, amount, to, fee });

/** One record, many recipients. The Rust side refuses a list too large to fit. */
export const tokenAirdrop = (
  from: string,
  token: string,
  payouts: [string, string][],
  fee?: number,
) => invoke<string>("token_airdrop", { from, token, payouts, fee });

export const tokenBurn = (from: string, token: string, amount: string, fee?: number) =>
  invoke<string>("token_burn", { from, token, amount, fee });

export const tokenLockSupply = (from: string, token: string, fee?: number) =>
  invoke<string>("token_lock_supply", { from, token, fee });

/**
 * Reserve a ticker. Returns [txid, salt].
 *
 * **Keep the salt.** The reveal cannot be built without it and it is not
 * recoverable from the chain: that is exactly what makes the reservation a
 * commitment rather than a public announcement of the name you want.
 */
export const tokenCommitTicker = (from: string, ticker: string, fee?: number) =>
  invoke<[string, string]>("token_commit_ticker", { from, ticker, fee });

// ── Divi Collectibles (NFD) ──────────────────────────────────────────────────
export interface NfdMint {
  txid: string;
  ownerAddr: string;
  contentHash: string;
  arweavePtr: string;
  thumbPtr: string | null;
}
export interface CollectionMintArgs {
  collectionId: string;
  creatorAddr: string;
  traitsJson: string; // ERC-721 attributes JSON, public
}
export const nfdMint = (
  contentB64: string,
  contentMime: string,
  encrypted: boolean,
  thumbnailB64?: string,
  thumbnailMime?: string,
  collection?: CollectionMintArgs,
) =>
  invoke<NfdMint>("nfd_mint", {
    contentB64,
    contentMime,
    encrypted,
    thumbnailB64,
    thumbnailMime,
    collectionId: collection?.collectionId,
    creatorAddr: collection?.creatorAddr,
    traitsJson: collection?.traitsJson,
  });

export interface ImportPlanItem {
  edition: number | null;
  name: string;
  tier: string | null;
  hasPreview: boolean;
  ok: boolean;
  error: string | null;
}
export interface ImportPlan {
  importDir: string;
  collection: { name: string; description: string; maxSupply: number; coverB64: string | null; coverMime: string | null; encrypted: boolean };
  items: ImportPlanItem[];
  okCount: number;
  warnings: { edition: number | null; error: string }[];
}
export interface ImportItem {
  name: string;
  tier: string | null;
  attributes: { trait_type: string; value: string }[];
  originalB64: string;
  originalMime: string;
  previewB64: string | null;
  previewMime: string | null;
}
export const nfdImportOpen = (zipPath: string) => invoke<ImportPlan>("nfd_import_open", { zipPath });
export const nfdImportReadItem = (importDir: string, edition: number) =>
  invoke<ImportItem>("nfd_import_read_item", { importDir, edition });
// Pre-split the creator's coins into `count` UTXOs so a batch doesn't stall.
// Returns the fan-out txid to wait on, or null if already enough UTXOs.
export const nfdPrepareFunding = (address: string, count: number) =>
  invoke<string | null>("nfd_prepare_funding", { address, count });
export const nfdTxConfirmations = (txid: string) => invoke<number>("nfd_tx_confirmations", { txid });

export interface NfdCollection {
  txid: string; // the collection id
  metaPtr: string;
  creatorAddr: string;
}
export const nfdCreateCollection = (
  creatorAddr: string,
  name: string,
  description: string,
  maxSupply: number,
  coverB64?: string,
  coverMime?: string,
) =>
  invoke<NfdCollection>("nfd_create_collection", {
    creatorAddr,
    name,
    description,
    maxSupply,
    coverB64,
    coverMime,
  });

export interface ReceiveCode {
  address: string;
  encPubkey: string;
}
export interface NfdTransfer {
  txid: string;
  wrapkeyPtr: string;
}
export const nfdReceiveCode = (address: string) => invoke<ReceiveCode>("nfd_receive_code", { address });
export const nfdTransfer = (ownerAddr: string, mintTxid: string, recipientAddr: string, recipientEncPubkey: string) =>
  invoke<NfdTransfer>("nfd_transfer", { ownerAddr, mintTxid, recipientAddr, recipientEncPubkey });
export const nfdClaim = (myAddr: string, mintTxid: string, wrapkeyPtr: string) =>
  invoke<string>("nfd_claim", { myAddr, mintTxid, wrapkeyPtr });

// ── Admin: fees / treasury + Arweave status ──────────────────────────────────
export interface FeeConfig {
  treasuryAddress: string;
  nfdMint: number;
}
export const nfdFeeConfig = () => invoke<FeeConfig>("nfd_fee_config");
export const nfdSetFeeConfig = (treasuryAddress: string, nfdMint: number) =>
  invoke<void>("nfd_set_fee_config", { treasuryAddress, nfdMint });

export interface RelayStatus {
  relayUrl: string;
  reachable: boolean;
  balanceWinc: string | null;
}
export const nfdRelayStatus = () => invoke<RelayStatus>("nfd_relay_status");
export const nfdView = (ownerAddr: string, arweavePtr: string, contentHash: string, encrypted: boolean) =>
  invoke<string>("nfd_view", { ownerAddr, arweavePtr, contentHash, encrypted });
// ---- Payment requests (DVXP type 0x05) ----
// A request only ASKS. Receiving one moves no money; paying is a separate,
// explicitly signed act by the payer.
export interface PayRequest {
  txid: string;
  payTo: string;            // 21-byte address encoding, hex
  payToAddress: string | null; // decoded back to a Divi address
  amountSats: number;       // 0 = payer chooses
  expiry: number;           // unix seconds, 0 = never
  memo: string;
  confirmations: number;
  time: number;
  notifyVout: number | null;
}
export const paymentRequestCreate = (
  payer: string,
  payTo: string,
  amount: number,
  expiry: number,
  memo: string,
) => invoke<string>("payment_request_create", { payer, payTo, amount, expiry, memo });
export const paymentRequestsInbox = (count = 100) =>
  invoke<PayRequest[]>("payment_requests_inbox", { count });

// ---- C2PA Content Credentials (READ only; we never create or sign them) ----
export interface C2paSummary {
  present: boolean;
  state: string; // Trusted | Valid | Invalid, from the C2PA SDK
  signer: string | null;
  generator: string | null;
  signedAt: string | null;
  title: string | null;
  assertions: string[];
  ingredients: number;
  issues: string[];
  diviTxid: string | null;
  json: string;
}
// Bytes are passed in because a browser File has no real path. The SDK is built
// without remote-manifest fetching, so this never touches the network.
export const c2paInspect = (bytes: number[], format: string) =>
  invoke<C2paSummary>("c2pa_inspect", { bytes, format });
export interface Peer {
  ip: string;
  inbound: boolean;
  pingMs: number;
  connSecs: number;
  bytesSent: number;
  bytesRecv: number;
  subver: string;
  height: number;
}
export interface PeerSnapshot {
  peers: Peer[];
  selfIp: string | null;
}
export interface Geo {
  ip: string;
  lat: number;
  lon: number;
  city: string;
  country: string;
  countryCode?: string; // ISO-2, e.g. "US"
  isp?: string;
}
export const networkPeers = () => invoke<PeerSnapshot | null>("network_peers");
export const geolocateIps = (ips: string[]) => invoke<Geo[]>("geolocate_ips", { ips });
// Resolve the DIVI snapshot server's real IP (so the setup map can draw the
// download firehose from its actual geographic location).
export const snapshotSourceIp = () => invoke<string | null>("snapshot_source_ip");
export const selfGeo = () => invoke<Geo | null>("self_geo");
export interface Block {
  height: number;
  time: number;
  txids: string[];
  stakeWinner: string | null;
  stakeAmount: number | null;
}
export const recentBlocks = (count: number) => invoke<Block[]>("recent_blocks", { count });

export interface PricePoint {
  ts: string; // ISO 8601 timestamp
  close: number;
}
export const priceHistory = () => invoke<PricePoint[]>("price_history");
// The full detailed first-run setup log, for the ⌘L copy shortcut. No secrets.
export const setupLogReport = () => invoke<string>("setup_log_report");
// Latest DIVI/USD from the shared CMC feed (no per-user key) — used to price PoE.
export const priceLatest = () => invoke<number | null>("price_latest");
export interface StaleBlock {
  height: number;
  status: string;
  branchLen: number;
}
export interface OrphanReport {
  stale: StaleBlock[];
  tip: number;
  span: number;
  ratePct: number;
}
// ⚠ Costs ~18 seconds on the node and stalls its block processing while it
// runs. On-demand only — never put this on a timer. Without `force` the Rust
// side serves a cached report.
export const chainOrphans = (force = false) => invoke<OrphanReport | null>("chain_orphans", { force });
export interface Probe {
  ip: string;
  online: boolean;
}
export const probePeers = (ips: string[]) => invoke<Probe[]>("probe_peers", { ips });

export interface NodePing {
  ip: string;
  online: boolean;
  ms: number;
}
export const pingNodes = (ips: string[]) => invoke<NodePing[]>("ping_nodes", { ips });

// ---- Live mempool (the Mempool panel) ----
export interface MemEntry {
  txid: string;
  size: number;
  feeSats: number;
  time: number;
  decoded: boolean; // true only for txids decoded this call; else keep cached flags
  mine: boolean; // involves the user's wallet (in or out)
  category: string; // "receive" | "send" | ""
  amountMine: number; // DIVI, net to/from the wallet
  hasData: boolean; // carries an OP_META data payload (a "message")
  fast: boolean; // carries the Fast Send "DFS1" on-chain marker
}
export interface MempoolSnap {
  tip: number;
  bestHash: string;
  entries: MemEntry[];
}
// `known` = txids the UI already classified, so only new txs get decoded.
export const mempoolSnapshot = (known: string[]) =>
  invoke<MempoolSnap | null>("mempool_snapshot", { known });

// Double-spend conflicts the node has seen. `kept` is the tx it accepted; a
// tracked incoming payment whose txid appears as `kept` is under attack.
export interface MempoolConflict {
  outpoint: string;
  kept: string;
  rejected: string;
  time: number;
}
export const mempoolConflicts = () => invoke<MempoolConflict[]>("mempool_conflicts");

// ---- Bearer transactions (redeemable claim codes) ----
export interface BearerCreated {
  code: string; // the redeemable code (this IS the money — treat as a secret)
  address: string;
  txid: string;
  vout: number;
  amount: number;
}
export interface BearerStatus {
  funded: boolean;
  claimed: boolean; // true once swept (claimed or reclaimed) or never funded
  value: number;
  receivable: number; // value minus the sweep fee = what the redeemer receives
  confirmations: number;
}
export const bearerCreate = (amount: number, passphrase?: string) =>
  invoke<BearerCreated>("bearer_create", { amount, passphrase: passphrase ?? null });
export const bearerSweep = (code: string, dest: string) =>
  invoke<string>("bearer_sweep", { code, dest });
export const bearerStatus = (code: string) => invoke<BearerStatus>("bearer_status", { code });

// ---- Pin Code Send: on-chain escrow (HTLC) ----
export interface EscrowCreated {
  ticket: string; // shareable, non-secret; lets the receiver see + later claim
  txid: string;
  vout: number;
  amount: number;
}
export interface EscrowStatus {
  funded: boolean;
  claimed: boolean;
  amount: number; // what the receiver would get (locked value minus claim fee)
  confirmations: number;
  recipient: string;
  sender: string;
  locktime: number; // unix time the sender can refund after
}
// `code` is the long random release code (generated in the UI); `locktime` is a
// unix time (sender-refund-after). Sender pays the fee.
export const escrowCreate = (recipient: string, amount: number, code: string, locktime: number, passphrase?: string) =>
  invoke<EscrowCreated>("escrow_create", { recipient, amount, code, locktime, passphrase: passphrase ?? null });
export const escrowStatus = (ticket: string) => invoke<EscrowStatus>("escrow_status", { ticket });
export const escrowClaim = (ticket: string, code: string, passphrase?: string) =>
  invoke<string>("escrow_claim", { ticket, code, passphrase: passphrase ?? null });
export const escrowRefund = (ticket: string, passphrase?: string) =>
  invoke<string>("escrow_refund", { ticket, passphrase: passphrase ?? null });

// ---- Treasury balances + native multisig ----
export interface AddrBalance {
  available: boolean; // false while the address index is still building
  balance: number;
  message: string;
}
// Balance of ANY address (treasury wallets, a multisig), read from our node's
// address index.
export const addressBalance = (address: string) =>
  invoke<AddrBalance>("address_balance", { address });

export interface MultisigWallet {
  label: string;
  address: string;
  m: number; // signatures required
  n: number; // total co-signers
  participants: string[];
  balance: number;
  balanceAvailable: boolean;
  definition: string; // shareable "DVMW1-…" wallet definition (also the backup)
  createdAt: number;
}
export interface MyKey {
  address: string;
  pubkey: string;
}
// A fresh address + its public key, to hand to co-signers when creating a
// shared wallet (this wallet keeps the private key so the address can sign).
export const multisigMyPubkey = () => invoke<MyKey>("multisig_my_pubkey");

export const multisigList = () => invoke<MultisigWallet[]>("multisig_list");
export const multisigCreate = (m: number, keys: string[], label: string) =>
  invoke<MultisigWallet>("multisig_create", { m, keys, label });
// Add a wallet someone else built, from its definition blob.
export const multisigImport = (definition: string) =>
  invoke<MultisigWallet>("multisig_import", { definition });
export const multisigForget = (address: string) => invoke<void>("multisig_forget", { address });

// What a pending spend REALLY does, decoded from the transaction itself
// (never trusting the blob's own labels).
export interface SpendOutput {
  address: string;
  amount: number;
  isChange: boolean; // paid back to the shared wallet
}
export interface SpendPreview {
  from: string;
  mixedSources: boolean; // inputs from more than one address (suspicious)
  sourceOk: boolean; // inputs really belong to the wallet the spend declares
  totalIn: number;
  outputs: SpendOutput[];
  totalOut: number;
  fee: number;
  signed: number;
  required: number;
  complete: boolean;
}
export const multisigInspect = (blob: string) => invoke<SpendPreview>("multisig_inspect", { blob });

// A shared wallet's deposits + spends, newest first (the treasury audit trail).
export interface MsActivity {
  txid: string;
  amount: number; // + deposit, - spend
  height: number;
  time: number; // unix seconds, 0 if unknown
  confirmations: number;
}
export const multisigActivity = (address: string, limit = 25) =>
  invoke<MsActivity[]>("multisig_activity", { address, limit });

export interface PendingSpend {
  blob: string; // the shareable pending-spend, passed between co-signers
  from: string;
  to: string;
  amount: number;
  fee: number;
  required: number;
}
export const multisigPropose = (fromAddress: string, to: string, amount: number) =>
  invoke<PendingSpend>("multisig_propose", { fromAddress, to, amount });

export interface SignResult {
  blob: string;
  complete: boolean;
  added: boolean; // did this wallet actually add a signature?
  signed: number;
  required: number;
  from: string;
  to: string;
  amount: number;
  fee: number;
}
export const multisigSign = (blob: string, passphrase?: string) =>
  invoke<SignResult>("multisig_sign", { blob, passphrase: passphrase ?? null });
export const multisigBroadcast = (blob: string) => invoke<string>("multisig_broadcast", { blob });

export const stakingWallets = () => invoke<StakeWallet[]>("staking_wallets");
export const lotteryInfo = () => invoke<LotteryInfo | null>("lottery_info");
export const lotteryWins = (addresses: string[]) => invoke<LotteryWin[]>("lottery_wins", { addresses });
export interface LotteryLeader {
  address: string;
  big: number;
  small: number;
  points: number;
}
export interface LotteryBoard {
  leaders: LotteryLeader[];
  yourBig: number;
  yourSmall: number;
  yourPoints: number;
}
export const lotteryBoard = (addresses: string[]) => invoke<LotteryBoard>("lottery_board", { addresses });
export interface StakeStart {
  staking: boolean;
  needsPassphrase: boolean;
  message: string;
}
export const startStaking = (passphrase?: string) => invoke<StakeStart>("start_staking", { passphrase: passphrase ?? null });
export const walletAddresses = () => invoke<AddrInfo[]>("wallet_addresses");
export const newReceiveAddress = () => invoke<string>("new_receive_address");
export const recentActivity = () => invoke<Tx[]>("recent_activity");
// null = node unreachable; [] = genuinely no (more) transactions.
export const listTransactions = (count: number, from: number) =>
  invoke<Tx[] | null>("list_transactions", { count, from });
export const validateAddress = (address: string) => invoke<boolean>("validate_address", { address });
export const walletOwns = (addresses: string[]) => invoke<boolean>("wallet_owns", { addresses });
export const addressQr = (address: string) => invoke<string>("address_qr", { address });
export const openUrl = (url: string) => invoke<void>("open_url", { url });

// ---- Coin maturity ----
export interface Utxo {
  address: string;
  amount: number;
  confirmations: number;
  matured: boolean;
  pct: number; // 0..100
  stakeableAt: number; // unix seconds, 0 once matured
}
export const coinMaturity = () => invoke<Utxo[]>("coin_maturity");

// ---- Wallet password / encryption ----
export interface WalletStatus {
  encrypted: boolean;
  unlocked: boolean;
  stakingOnly: boolean;
  remembered: boolean;
  status: string;
}
export const walletStatus = () => invoke<WalletStatus>("wallet_status");
export const unlockWallet = (passphrase: string, stakingOnly: boolean, seconds: number) =>
  invoke<void>("unlock_wallet", { passphrase, stakingOnly, seconds });
export const lockWallet = () => invoke<void>("lock_wallet");
export const changePassphrase = (oldPass: string, newPass: string) =>
  invoke<void>("change_passphrase", { old: oldPass, new: newPass });
export const encryptWallet = (passphrase: string) => invoke<string>("encrypt_wallet", { passphrase });
export const walletSeed = () => invoke<string>("wallet_seed");
export const rememberPassword = (passphrase: string) => invoke<void>("remember_password", { passphrase });
export const forgetPassword = () => invoke<void>("forget_password");
export const resumeStaking = () => invoke<StakeStart>("resume_staking");
export const sendCoins = (address: string, amount: number, passphrase?: string) =>
  invoke<string>("send_coins", { address, amount, passphrase: passphrase ?? null });
// Fast Send: raw tx with a ~5x priority fee + on-chain DFS1 marker.
export const fastSend = (address: string, amount: number, passphrase?: string) =>
  invoke<string>("fast_send", { address, amount, passphrase: passphrase ?? null });

// Live status of one wallet transaction, for the Fast Send tracker. Negative
// `confirmations` means the node sees a conflicting (double-spent) transaction.
export interface TxStatus {
  found: boolean;
  confirmations: number;
  time: number;
  amount: number;
  category: string;
}
export const txStatus = (txid: string) => invoke<TxStatus>("tx_status", { txid });

// ---- DIVI price / value ----
export interface DiviPrices {
  prices: Record<string, number>; // lowercase currency code -> price per DIVI
  coingeckoOk: boolean;
  coinmarketcapOk: boolean;
  cmcError?: string | null; // why CoinMarketCap failed, when a key is set
}
export const diviPrices = (currencies: string[], cmcKey: string, useCoingecko: boolean) =>
  invoke<DiviPrices>("divi_prices", { currencies, cmcKey: cmcKey || null, useCoingecko });

// Divi Love Scan (scan.divi.love) — our own block explorer — transaction page.
export const explorerTxUrl = (txid: string) => `https://scan.divi.love/tx/${txid}`;

// ── AI provider keys (bring-your-own-key), stored in the OS keychain only. The
// actual secrets are never read back into the UI — only whether each is set.
export interface AiStatus {
  claude: boolean;
  grok: boolean;
  /** A token for the gateway. Not a model key: revocable on its own. */
  gatewayToken: boolean;
  gateway: string;
}
export const aiStatus = () => invoke<AiStatus>("ai_status");
export const aiSetKey = (provider: string, key: string) => invoke<void>("ai_set_key", { provider, key });
export const aiClearKey = (provider: string) => invoke<void>("ai_clear_key", { provider });

// Market Maker: trade-only exchange keys live in the OS keychain (Rust side); the
// UI only ever gets balances back, never the key itself.
export interface MmBalance {
  asset: string;
  free: number;
  locked: number;
}
export const mmSaveCredentials = (slug: string, apiKey: string, apiSecret: string, passphrase?: string) =>
  invoke<void>("mm_save_credentials", { slug, apiKey, apiSecret, passphrase: passphrase ?? null });
export const mmHasCredentials = (slug: string) => invoke<boolean>("mm_has_credentials", { slug });
export const mmClearCredentials = (slug: string) => invoke<void>("mm_clear_credentials", { slug });
export const mmTestConnection = (slug: string, connector: string, restUrl: string) =>
  invoke<MmBalance[]>("mm_test_connection", { slug, connector, restUrl });

// The live quoting engine (start/stop/status). One market maker runs at a time.
export interface MmStatus {
  running: boolean;
  message: string;
  mid: number;
  openOrders: number;
  baseFree: number;
  baseHeld: number;
  quoteFree: number;
  quoteHeld: number;
  cycles: number;
}
export const mmStart = (
  slug: string, connector: string, restUrl: string, symbol: string,
  levels: number[], commitUsdt: number, refreshSecs: number, protectPct: number,
) => invoke<void>("mm_start", { slug, connector, restUrl, symbol, levels, commitUsdt, refreshSecs, protectPct });
export const mmStop = () => invoke<void>("mm_stop");
export const mmStatus = () => invoke<MmStatus>("mm_status");
// Cancel every resting order for a pair, even when the engine isn't running.
export const mmCancelAll = (slug: string, connector: string, restUrl: string, symbol: string) =>
  invoke<number>("mm_cancel_all", { slug, connector, restUrl, symbol });

// A live order-book snapshot for the depth-ladder view: the public book, our own
// resting orders, mid, and balances — one read-only call, polled while visible.
export interface BookLevel { price: number; size: number }
export interface OpenOrder { side: "buy" | "sell"; price: number; size: number }
export interface MmBook {
  mid: number;
  bestBid: number;
  bestAsk: number;
  asks: BookLevel[]; // ascending price (lowest ask first)
  bids: BookLevel[]; // descending price (highest bid first)
  ourOrders: OpenOrder[];
  baseFree: number;
  baseHeld: number;
  quoteFree: number;
  quoteHeld: number;
}
export const mmBook = (slug: string, connector: string, restUrl: string, symbol: string) =>
  invoke<MmBook>("mm_book", { slug, connector, restUrl, symbol });

// Realized market-making P&L, reconstructed from the exchange's own filled-order
// history: the source of truth for where the money went.
export interface TradePnl {
  fills: number; buys: number; sells: number;
  diviBought: number; diviSold: number; usdtSpent: number; usdtRecv: number;
  avgBuy: number; avgSell: number;
  netDivi: number; netUsdt: number; grossVolume: number;
  mid: number; totalPnl: number; firstMs: number; lastMs: number;
}
export const mmTradeHistory = (slug: string, connector: string, restUrl: string, symbol: string, source: "mm" | "manual") =>
  invoke<TradePnl>("mm_trade_history", { slug, connector, restUrl, symbol, source });

// Manual trading: the user's own buy/sell orders (not the engine's).
export interface ManualOrder { id: string; side: string; orderType: string; price: number; qty: number; fromMm: boolean; createdMs: number; }
export const mmPlaceOrder = (
  slug: string, connector: string, restUrl: string, symbol: string,
  side: "buy" | "sell", orderType: "limit" | "market", quantity: number, price: number | null,
) => invoke<string>("mm_place_order", { slug, connector, restUrl, symbol, side, orderType, quantity, price });
export const mmCancelOrder = (slug: string, connector: string, restUrl: string, id: string) =>
  invoke<void>("mm_cancel_order", { slug, connector, restUrl, id });
export const mmOpenOrders = (slug: string, connector: string, restUrl: string, symbol: string) =>
  invoke<ManualOrder[]>("mm_open_orders", { slug, connector, restUrl, symbol });

// DEX (Uniswap V2 eDIVI/WETH on Ethereum): live pool reserves + on-chain ETH/USD.
// Read-only; used by the DEX tab to price swaps. Swapping (wallet) is a later phase.
export interface DexPool {
  reserveEdivi: number;
  reserveWeth: number;
  ethUsd: number;
  ediviDecimals: number;
}
export const dexPool = () => invoke<DexPool>("dex_pool");

// My Nodes: which node the wallet reads. Desktop is built in; personal nodes
// (e.g. DIVI LOVE SCAN) live only in this machine's nodes.json.
export interface NodeInfo {
  id: string;
  label: string;
  mode: string; // "local" | "remote"
  host?: string | null;
  port?: number | null;
  user?: string | null;
  has_pass: boolean;
  datadir?: string | null;
  builtin: boolean;
}
export interface NodesResp {
  active: string;
  nodes: NodeInfo[];
}
export const listNodes = () => invoke<NodesResp>("list_nodes");
export const setActiveNode = (id: string) => invoke<void>("set_active_node", { id });
