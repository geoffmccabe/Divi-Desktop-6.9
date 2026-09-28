import { useEffect, useState } from "react";
import {
  walletBalance,
  vaultBalance,
  vaultFund,
  vaultReclaim,
  vaultManagerAddress,
  newReceiveAddress,
  type Balance,
} from "./api";
import { fmtDivi } from "../status";
import { feeLabel } from "./vaultFee";
import "./vaults.css";

// The Vaults panel. Two tabs:
//   Self-Custody (default) - the real on-chain Divi vault. Coins stay the
//     user's; the main node only keeps them staking. Deposit funds a vault to
//     the main node's manager address; Withdraw reclaims to the owner.
//   Custodial - a doorway to DiviGo, the Telegram wallet that stakes for you.
//
// Money moves (deposit/withdraw) need the wallet unlocked first, exactly like
// Send. We never take a passphrase here: if the node is locked it returns an
// error, which we show with a hint to unlock.

type Tab = "self" | "custodial";
type Confirm = null | "deposit" | "withdraw";

// The real DiviGo Telegram handle goes here once we have it; until then the
// "Set up DiviGo" button stays disabled rather than pointing nowhere.
const DIVIGO_TELEGRAM = "";

export function VaultsPanel() {
  const [tab, setTab] = useState<Tab>("self");
  const [bal, setBal] = useState<Balance | null>(null);
  const [vaulted, setVaulted] = useState<number | null>(null);
  const [manager, setManager] = useState<string | null>(null);

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    walletBalance()
      .then((v) => setBal(v))
      .catch(() => {});
    vaultBalance()
      .then((v) => setVaulted(v))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    vaultManagerAddress()
      .then((a) => setManager(a))
      .catch(() => {});
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, []);

  const doDeposit = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const amount = parseFloat(depositAmt);
      if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
      const mgr = manager ?? (await vaultManagerAddress());
      if (!mgr) throw new Error("Couldn't find the main node's staking address.");
      const owner = await newReceiveAddress();
      const txid = await vaultFund(owner, mgr, amount);
      setMsg(`Vaulted ${fmtDivi(amount)} DIVI. Transaction ${txid.slice(0, 12)}…`);
      setDepositAmt("");
      refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const doWithdraw = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const amount = parseFloat(withdrawAmt);
      if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");
      if (!withdrawTo.trim()) throw new Error("Enter an address to withdraw to.");
      const txid = await vaultReclaim(withdrawTo.trim(), amount);
      setMsg(`Withdrew ${fmtDivi(amount)} DIVI. Transaction ${txid.slice(0, 12)}…`);
      setWithdrawAmt("");
      refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="vault">
      <header className="vault-intro">
        <h3 className="ts-head">Vaults</h3>
        <p className="wl-note">
          Keep earning on your DIVI without leaving this computer on. Choose to stay in full control
          of your coins, or let DiviGo do it all for you.
        </p>
      </header>

      <div className="vault-tabs">
        <button
          type="button"
          className={"vault-tab" + (tab === "self" ? " vault-tab-on" : "")}
          onClick={() => setTab("self")}
        >
          Self-Custody
        </button>
        <button
          type="button"
          className={"vault-tab" + (tab === "custodial" ? " vault-tab-on" : "")}
          onClick={() => setTab("custodial")}
        >
          Custodial
        </button>
      </div>

      {tab === "self" ? (
        <section>
          <p className="wl-note">
            Vault your DIVI and keep full custody. Your coins never leave your control. You only let
            the main node keep them staking for you, so you earn rewards even with this computer
            turned off. Take them back whenever you like.
          </p>

          <div className="balance-cards">
            <div className="balance-card">
              <span className="bl-label">Your coins</span>
              <span className="bl-amt">
                {bal ? fmtDivi(bal.spendable) : "—"} <em>DIVI</em>
              </span>
            </div>
            <div className="balance-card">
              <span className="bl-label">In vaults</span>
              <span className="bl-amt">
                {vaulted != null ? fmtDivi(vaulted) : "—"} <em>DIVI</em>
              </span>
            </div>
          </div>

          <div className="vault-fee-row">
            <span>Vaulting fee</span>
            <strong>{feeLabel(vaulted ?? 0)}</strong>
          </div>

          {msg && <div className="vault-banner">{msg}</div>}
          {err && (
            <div className="vault-banner">
              {err}
              {/wallet is locked|unlock|locked/i.test(err) && " Unlock your wallet, then try again."}
            </div>
          )}

          <h4 className="vault-section-head">Deposit to vault</h4>
          <div className="vault-actions">
            <input
              className="wl-input"
              inputMode="decimal"
              placeholder="Amount in DIVI"
              value={depositAmt}
              onChange={(e) => setDepositAmt(e.target.value)}
            />
            <button
              type="button"
              className="wl-btn"
              disabled={busy || !(parseFloat(depositAmt) > 0)}
              onClick={() => setConfirm("deposit")}
            >
              Deposit
            </button>
          </div>
          {confirm === "deposit" && (
            <div className="vault-banner">
              Vault {fmtDivi(parseFloat(depositAmt) || 0)} DIVI to the main node?
              <div className="vault-actions">
                <button type="button" className="wl-btn" disabled={busy} onClick={doDeposit}>
                  Confirm
                </button>
                <button type="button" className="wl-btn" disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <h4 className="vault-section-head">Withdraw from vault</h4>
          <div className="vault-actions">
            <input
              className="wl-input"
              placeholder="Your DIVI address"
              value={withdrawTo}
              onChange={(e) => setWithdrawTo(e.target.value)}
            />
            <input
              className="wl-input"
              inputMode="decimal"
              placeholder="Amount in DIVI"
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(e.target.value)}
            />
            <button
              type="button"
              className="wl-btn"
              disabled={busy || !(parseFloat(withdrawAmt) > 0) || !withdrawTo.trim()}
              onClick={() => setConfirm("withdraw")}
            >
              Withdraw
            </button>
          </div>
          {confirm === "withdraw" && (
            <div className="vault-banner">
              Withdraw {fmtDivi(parseFloat(withdrawAmt) || 0)} DIVI to {withdrawTo.trim()}?
              <div className="vault-actions">
                <button type="button" className="wl-btn" disabled={busy} onClick={doWithdraw}>
                  Confirm
                </button>
                <button type="button" className="wl-btn" disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <h4 className="vault-section-head">Vault payments</h4>
          <ul className="activity">
            <li className="wl-empty">
              Vault staking rewards appear in your Transaction History as stakes.
            </li>
          </ul>
        </section>
      ) : (
        <section>
          <p className="wl-note">
            Prefer to have everything run for you? DiviGo is a wallet on Telegram that stakes your
            DIVI on your behalf and shares the rewards. Move your DIVI to DiviGo and it does the rest,
            with nothing for you to keep online.
          </p>

          <ol className="vault-how">
            <li>Open DiviGo on Telegram and create your wallet.</li>
            <li>Move some DIVI across from this wallet.</li>
            <li>DiviGo stakes it for you and pays you your share.</li>
          </ol>

          <p className="wl-note">
            Once you set it up here, your DiviGo wallet links into this app so you can see it
            alongside everything else.
          </p>

          <div className="vault-actions">
            <button
              type="button"
              className="wl-btn"
              disabled={!DIVIGO_TELEGRAM}
              title={DIVIGO_TELEGRAM ? "Open DiviGo on Telegram" : "Coming soon"}
            >
              Set up DiviGo
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
