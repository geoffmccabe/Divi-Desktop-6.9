import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  walletAddresses, walletsList, walletCreate, walletRestore, walletNewAddress, walletSetLabel, walletSetVault, walletWords, walletRemove,
  walletVaultFund, walletVaultReclaim,
  type ExtraWallet, type AddrInfo,
} from "./api";
import { fmtDivi } from "../status";
import { hraMyNames } from "./hra/api";
import { loadNames } from "./addressNames";

// The wallets under one node in Settings > My Nodes
// (docs/PARALLEL-WALLETS-PLAN.md, Phase 1).
//
// The STAKING WALLET is the node's own wallet, always first. Extra wallets
// are the app's: each has its own twelve words, shown once at creation. They
// are drawn indented so it is plain they are second wallets, not the node.
// Every address row has a name (white, local) and an HRA slot (bold gold
// once a name is assigned; until then "No HRA" and a Get HRA button), and a
// vault-staking tick whose effect arrives with Phase 2.

const INDENT = 100;

function short(a: string): string {
  return a.length > 18 ? `${a.slice(0, 9)}…${a.slice(-6)}` : a;
}

function AddressRow({
  address, label, divi, vaulted, vaultPending, vault, locked, hra, onLabel, onVault, onStake, onUnstake, onGetHra, main,
}: {
  address: string; label: string; divi?: number; vaulted?: number; vaultPending?: number; vault?: boolean; locked?: boolean; hra?: string | null;
  onLabel?: (v: string) => Promise<void>; onVault?: (on: boolean) => Promise<void>;
  onStake?: () => void; onUnstake?: () => void; onGetHra?: () => void; main?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [copied, setCopied] = useState(false);
  useEffect(() => setDraft(label), [label]);
  const copy = () => {
    navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className={"nw-addr" + (main ? " nw-addr-main" : "")}>
      <div className="nw-addr-top">
        {editing && onLabel ? (
          <input
            className="wl-input nw-addr-name"
            value={draft}
            maxLength={40}
            autoFocus
            placeholder="Name this address"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter") { await onLabel(draft); setEditing(false); }
              if (e.key === "Escape") { setDraft(label); setEditing(false); }
            }}
            onBlur={async () => { if (draft !== label) await onLabel(draft); setEditing(false); }}
          />
        ) : (
          <button type="button" className="nw-addr-namebtn" onClick={() => onLabel && setEditing(true)} title={onLabel ? "Click to name" : undefined}>
            {label || (main ? "Main address" : "Unnamed address")}
          </button>
        )}
        <code className="nw-addr-code" title={address}>{short(address)}</code>
        <button type="button" className="wl-btn nw-mini" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        {typeof divi === "number" && (
          <span className="nw-addr-bal">
            {fmtDivi(divi)} DIVI
            {typeof vaulted === "number" && vaulted > 0 && <> · <span className="nw-vaulted">{fmtDivi(vaulted)} staking</span></>}
            {!!vaultPending && <> · <span className="nw-pending">{vaultPending} deposit{vaultPending === 1 ? "" : "s"} awaiting confirmation</span></>}
          </span>
        )}
      </div>
      <div className="nw-addr-bottom">
        {hra ? (
          <span className="nw-hra-on">HRA: <b>{hra}</b></span>
        ) : (
          <span className="nw-hra-off">
            No HRA - Human Readable Address yet
            {onGetHra && <button type="button" className="wl-btn nw-mini" onClick={onGetHra}>Get HRA</button>}
          </span>
        )}
        {onVault && (
          <span className="nw-vault-wrap">
            <label className="nw-vault" title="Coins at this address are placed in a vault: you keep custody, this node only stakes them. Rewards and lottery wins land in the vault too.">
              <input type="checkbox" checked={!!vault} onChange={(e) => void onVault(e.target.checked)} />
              Vault staking
              <small>
                {vault
                  ? locked
                    ? "(this wallet has its own password, so press Stake now to move coins)"
                    : "(coins of 1 DIVI or more move into the vault by themselves)"
                  : "(off: coins stay plain and do not stake)"}
              </small>
            </label>
            {vault && locked && typeof divi === "number" && divi > 0 && onStake && (
              <button type="button" className="wl-btn nw-mini" onClick={onStake}>Stake now</button>
            )}
            {typeof vaulted === "number" && vaulted > 0 && onUnstake && (
              <button type="button" className="wl-btn nw-mini" onClick={onUnstake} title="Takes everything out of the vault back to this address and turns vault staking off">Unstake</button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function NodeWallets({ nodeId, nodeLabel, onGetHra }: { nodeId: string; nodeLabel: string; onGetHra: (address: string, label: string) => void }) {
  const [staking, setStaking] = useState<AddrInfo[]>([]);
  const [wallets, setWallets] = useState<ExtraWallet[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPass, setNewPass] = useState("");
  const [usePass, setUsePass] = useState(false);
  /* "I already have twelve words": restore instead of create. */
  const [restoring, setRestoring] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [words, setWords] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [askPass, setAskPass] = useState<{ walletId: string; what: "address" | "words" | "stake" | "unstake"; address?: string } | null>(null);
  const [passDraft, setPassDraft] = useState("");
  const [shownWords, setShownWords] = useState<{ id: string; words: string[] } | null>(null);
  /* One in-app confirm box for the two things that move or drop something. */
  const [ask, setAsk] = useState<{ title: string; text: string; yes: string; run: () => Promise<void> } | null>(null);
  /* Names this node owns, by the address they pay to, for the HRA slot. */
  const [names, setNames] = useState<Record<string, string>>({});

  const refresh = async () => {
    try {
      const [a, w] = await Promise.all([walletAddresses().catch(() => [] as AddrInfo[]), walletsList()]);
      setStaking(a);
      setWallets(w);
      hraMyNames()
        .then((list) => {
          const m: Record<string, string> = {};
          for (const n of list) {
            if (n.diviAddress) m[n.diviAddress] = n.name;
            else m[n.owner] = m[n.owner] ?? n.name;
          }
          setNames(m);
        })
        .catch(() => {});
    } catch (e) {
      setNote(String(e));
    }
  };
  useEffect(() => { void refresh(); }, [nodeId]);

  const create = async () => {
    setBusy(true); setNote("");
    try {
      if (restoring) {
        await walletRestore(newLabel, phrase, usePass ? newPass : undefined);
        setPhrase("");
      } else {
        const r = await walletCreate(newLabel, usePass ? newPass : undefined);
        setWords(r.words);
      }
      setConfirm(false); setNewLabel(""); setNewPass(""); setUsePass(false); setRestoring(false);
      await refresh();
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  const withPass = async (w: ExtraWallet, what: "address" | "words" | "stake" | "unstake", run: (pass?: string) => Promise<void>, address?: string) => {
    if (w.lockedWithPassword) { setAskPass({ walletId: w.id, what, address }); setPassDraft(""); return; }
    await run(undefined);
  };
  const stake = (w: ExtraWallet, address: string, pass?: string) => async () => {
    setBusy(true); setNote("");
    try { await walletVaultFund(w.id, address, undefined, pass); await refresh(); } catch (e) { setNote(String(e)); } finally { setBusy(false); }
  };
  const unstake = (w: ExtraWallet, address: string, pass?: string) => async () => {
    setAsk({
      title: "Unstake this address?",
      text: "Everything in its vault comes back as plain coins and stops earning. Vault staking is turned off for it; tick it again to restart.",
      yes: "Unstake",
      run: async () => {
        setBusy(true); setNote("");
        try { await walletVaultReclaim(w.id, address, undefined, pass); await refresh(); } catch (e) { setNote(String(e)); } finally { setBusy(false); }
      },
    });
  };

  const addAddress = (w: ExtraWallet) => withPass(w, "address", async (pass) => {
    setBusy(true); setNote("");
    try { await walletNewAddress(w.id, "", pass); await refresh(); } catch (e) { setNote(String(e)); } finally { setBusy(false); }
  });
  const showWords = (w: ExtraWallet) => withPass(w, "words", async (pass) => {
    try { setShownWords({ id: w.id, words: await walletWords(w.id, pass) }); } catch (e) { setNote(String(e)); }
  });
  const remove = (w: ExtraWallet) => setAsk({
    title: `Remove "${w.label}"?`,
    text: "It disappears from this app only. Its coins stay on the chain, and its seed words bring it back anywhere.",
    yes: "Remove",
    run: async () => {
      try { await walletRemove(w.id, false); await refresh(); }
      catch (e) {
        const m = String(e);
        if (m.includes("still holds")) {
          setAsk({ title: "It still holds coins", text: `${m} Remove it anyway? Only its seed words can bring the coins back.`, yes: "Remove anyway", run: async () => {
            try { await walletRemove(w.id, true); await refresh(); } catch (e2) { setNote(String(e2)); }
          } });
        } else setNote(m);
      }
    },
  });

  const total = wallets.reduce((s, w) => s + w.divi + w.vaulted, 0);
  /* The node's own address names live in My Addresses (top right); shown
     here read-only so the same address reads the same everywhere. */
  const nodeNames = loadNames();
  const main = staking.find((a) => a.isMain) ?? staking[0];

  return (
    <div className="nw-block">
      <div className="nw-head">
        <span className="nw-title">Wallets on {nodeLabel}</span>
        <button type="button" className="wl-btn wl-btn-primary nw-add" disabled={wallets.length >= 20} onClick={() => setConfirm(true)}>
          +WALLET
        </button>
      </div>

      {/* The node's own wallet, always first. */}
      <div className="nw-wallet nw-staking">
        <div className="nw-wallet-head">
          <b>Staking Wallet</b>
          <span className="nw-wallet-sub">the node's own wallet; everything in it stakes</span>
        </div>
        {main ? (
          <AddressRow address={main.address} label={nodeNames[main.address] ?? ""} main hra={names[main.address] ?? null} onGetHra={() => onGetHra(main.address, "Staking Wallet")} />
        ) : (
          <p className="set-note">Reading the node's addresses…</p>
        )}
        {staking.filter((a) => a !== main).slice(0, 6).map((a) => (
          <AddressRow key={a.address} address={a.address} label={nodeNames[a.address] ?? ""} hra={names[a.address] ?? null} onGetHra={() => onGetHra(a.address, "Staking Wallet")} />
        ))}
        {staking.length > 7 && <p className="set-note">…and {staking.length - 7} more, under My Addresses at the top right (where these addresses are named).</p>}
      </div>

      {wallets.map((w) => (
        <div key={w.id} className="nw-wallet nw-extra" style={{ marginLeft: INDENT }}>
          <div className="nw-wallet-head">
            <b>{w.label}</b>
            <span className="nw-wallet-bal">{w.balanceKnown ? `${fmtDivi(w.divi + w.vaulted)} DIVI${w.vaulted > 0 ? ` (${fmtDivi(w.vaulted)} staking)` : ""}` : "balance unavailable right now"}</span>
            {w.lockedWithPassword && <span className="nw-wallet-sub">own password</span>}
            <span className="nw-wallet-tools">
              <button type="button" className="wl-btn nw-mini" disabled={busy} onClick={() => void addAddress(w)}>New address</button>
              <button type="button" className="wl-btn nw-mini" onClick={() => void showWords(w)}>Show words</button>
              <button type="button" className="wl-btn nw-mini" onClick={() => void remove(w)}>Remove</button>
            </span>
          </div>
          {w.addresses.map((a) => (
            <AddressRow
              key={a.address}
              address={a.address}
              label={a.label}
              divi={w.balanceKnown ? a.divi : undefined}
              vaulted={w.balanceKnown ? a.vaulted : undefined}
              vaultPending={a.vaultPending}
              vault={a.vault}
              locked={w.lockedWithPassword}
              onStake={() => void withPass(w, "stake", (p) => stake(w, a.address, p)(), a.address)}
              onUnstake={() => void withPass(w, "unstake", (p) => unstake(w, a.address, p)(), a.address)}
              hra={names[a.address] ?? null}
              main={a.index === 0}
              onLabel={async (v) => { await walletSetLabel(w.id, a.address, v); await refresh(); }}
              onVault={async (on) => { await walletSetVault(w.id, a.address, on); await refresh(); }}
              onGetHra={() => onGetHra(a.address, w.label)}
            />
          ))}
          {shownWords?.id === w.id && (
            <div className="nw-words">
              <p className="set-note">These words ARE this wallet. Write them down; anyone with them has its coins.</p>
              <code className="rs-key-hex">{shownWords.words.join(" ")}</code>
              <button type="button" className="wl-btn nw-mini" onClick={() => setShownWords(null)}>Hide</button>
            </div>
          )}
        </div>
      ))}
      {wallets.length > 1 && <p className="set-note nw-total">All extra wallets: {fmtDivi(total)} DIVI</p>}
      {wallets.some((w) => w.addresses.some((a) => a.vaultPending > 0)) && (
        <p className="set-note nw-total">
          A vault deposit is registered with the node after one confirmation (a few minutes). If one stays
          "awaiting" for over an hour, restart the node from this page: vault staking was switched on in its
          settings and takes effect when it next starts. The coins are safe in the vault meanwhile.
        </p>
      )}
      {note && <p className="pw-msg rs-bad">{note}</p>}

      {confirm && createPortal(
        <div className="poe-modal-backdrop" onClick={() => !busy && setConfirm(false)} role="presentation">
          <div className="poe-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Create a new wallet">
            <div className="poe-modal-head"><h3>{restoring ? "Bring back a wallet" : "Create a new Wallet?"}</h3></div>
            <div className="poe-modal-body">
              {restoring ? (
                <p className="wl-note">
                  Type its 12 or 24 words. The wallet's addresses and coins are found again on the chain.
                </p>
              ) : (
                <p className="wl-note">
                  A separate wallet with its own twelve words, beside the staking wallet. You will see the
                  words once; write them down.
                </p>
              )}
              <input className="wl-input" placeholder="Name (e.g. Kids, Savings, Game pool)" value={newLabel} maxLength={40} onChange={(e) => setNewLabel(e.target.value)} />
              {restoring && (
                <textarea className="wl-input nw-phrase" rows={3} placeholder="12 or 24 words, in order" value={phrase} spellCheck={false} autoCapitalize="off" onChange={(e) => setPhrase(e.target.value)} />
              )}
              <label className="pw-check">
                <input type="checkbox" checked={usePass} onChange={(e) => setUsePass(e.target.checked)} />
                Lock this wallet with its own password
              </label>
              {usePass && (
                <input className="wl-input" type="password" placeholder="Wallet password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
              )}
              <div className="upd-actions">
                <button type="button" className="upd-go" disabled={busy || (usePass && newPass.length < 4) || (restoring && ![12, 24].includes(phrase.trim().split(/\s+/).length))} onClick={() => void create()}>
                  {busy ? (restoring ? "Finding it…" : "Creating…") : "Confirm"}
                </button>
                <button type="button" className="wl-btn" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
                <button type="button" className="wl-link nw-swap" disabled={busy} onClick={() => setRestoring((r) => !r)}>
                  {restoring ? "Make a new one instead" : "I already have a seed phrase"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {words && createPortal(
        <div className="poe-modal-backdrop" role="presentation">
          <div className="poe-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Your new wallet's words">
            <div className="poe-modal-head"><h3>Write these words down</h3></div>
            <div className="poe-modal-body">
              <p className="wl-note">
                They are the wallet. They are shown now and can be shown again from the wallet's
                <b> Show words</b> button, but only from this app on this computer. Anyone with
                them has the coins.
              </p>
              <ol className="nw-wordlist">{words.map((w, i) => <li key={i}>{w}</li>)}</ol>
              <div className="upd-actions">
                <button type="button" className="upd-go" onClick={() => setWords(null)}>I have written them down</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {ask && createPortal(
        <div className="poe-modal-backdrop" onClick={() => setAsk(null)} role="presentation">
          <div className="poe-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={ask.title}>
            <div className="poe-modal-head"><h3>{ask.title}</h3></div>
            <div className="poe-modal-body">
              <p className="wl-note">{ask.text}</p>
              <div className="upd-actions">
                <button type="button" className="upd-go" onClick={() => { const r = ask.run; setAsk(null); void r(); }}>{ask.yes}</button>
                <button type="button" className="wl-btn" onClick={() => setAsk(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {askPass && createPortal(
        <div className="poe-modal-backdrop" onClick={() => setAskPass(null)} role="presentation">
          <div className="poe-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Wallet password">
            <div className="poe-modal-head"><h3>This wallet's password</h3></div>
            <div className="poe-modal-body">
              <input className="wl-input" type="password" autoFocus value={passDraft} onChange={(e) => setPassDraft(e.target.value)} />
              <div className="upd-actions">
                <button type="button" className="upd-go" onClick={async () => {
                  const w = wallets.find((x) => x.id === askPass.walletId);
                  const p = passDraft; const what = askPass.what;
                  setAskPass(null);
                  if (!w) return;
                  if (what === "address") { setBusy(true); try { await walletNewAddress(w.id, "", p); await refresh(); } catch (e) { setNote(String(e)); } finally { setBusy(false); } }
                  if (what === "words") { try { setShownWords({ id: w.id, words: await walletWords(w.id, p) }); } catch (e) { setNote(String(e)); } }
                  if (what === "stake" && askPass.address) await stake(w, askPass.address, p)();
                  if (what === "unstake" && askPass.address) await unstake(w, askPass.address, p)();
                }}>Unlock</button>
                <button type="button" className="wl-btn" onClick={() => setAskPass(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
