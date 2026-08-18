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
) =>
  invoke<string>("poe_timestamp", {
    hash,
    fee: fee ?? null,
    payoutAddr: payoutAddr?.trim() || null,
    payoutDivi: payoutDivi ?? null,
  });
export const poeVerify = (txid: string, hash: string) => invoke<Proof>("poe_verify", { txid, hash });

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
export const selfGeo = () => invoke<Geo | null>("self_geo");
export interface Block {
  height: number;
  time: number;
  txids: string[];
  stakeWinner: string | null;
  stakeAmount: number | null;
}
export const recentBlocks = (count: number) => invoke<Block[]>("recent_blocks", { count });
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
  createdAt: number;
}
export const multisigList = () => invoke<MultisigWallet[]>("multisig_list");
export const multisigCreate = (m: number, keys: string[], label: string) =>
  invoke<MultisigWallet>("multisig_create", { m, keys, label });
export const multisigForget = (address: string) => invoke<void>("multisig_forget", { address });

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
  gateway: string;
}
export const aiStatus = () => invoke<AiStatus>("ai_status");
export const aiSetKey = (provider: string, key: string) => invoke<void>("ai_set_key", { provider, key });
export const aiClearKey = (provider: string) => invoke<void>("ai_clear_key", { provider });

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
