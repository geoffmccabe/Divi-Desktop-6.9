import { useEffect, useState } from "react";
import {
  walletStatus,
  encryptWallet,
  changePassphrase,
  walletSeed,
  rememberPassword,
  forgetPassword,
  type WalletStatus,
} from "./api";
import { getAskMode, setAskMode, type AskMode } from "./securityPrefs";

// Settings → Password. Drives the node's real wallet encryption (encryptwallet /
// walletpassphrasechange). No separate "app password" — that would be theater.

const MODES: { id: AskMode; label: string; hint: string }[] = [
  { id: "always", label: "Always ask", hint: "Ask for the password on every send." },
  { id: "send", label: "Ask only on send", hint: "Stakes in the background; asks only when you send." },
  { id: "open", label: "Leave open", hint: "Fully unlocked — sends need no password. Least secure." },
];

// First-time encryption: force a seed backup, then set the password.
function SetPassword({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"seed" | "password">("seed");
  const [seed, setSeed] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const showSeed = async () => {
    setErr(null);
    try {
      setSeed(await walletSeed());
    } catch (e) {
      setErr(String(e));
    }
  };

  const encrypt = async () => {
    setErr(null);
    if (p1.length < 8) return setErr("Use at least 8 characters.");
    if (p1 !== p2) return setErr("The two passwords don’t match.");
    setBusy(true);
    try {
      await encryptWallet(p1);
      onDone();
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  return (
    <div className="pw-box">
      <div className="pw-warn">
        ⚠ There is no password reset. If you lose this password, your coins are gone forever. Back up
        your seed phrase first.
      </div>
      {step === "seed" ? (
        <>
          {!seed ? (
            <button type="button" className="wl-btn" onClick={showSeed}>
              Show my seed phrase
            </button>
          ) : (
            <>
              <div className="pw-seed">{seed}</div>
              <label className="pw-check">
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                I’ve written these words down and stored them somewhere safe.
              </label>
              <button type="button" className="wl-btn wl-btn-primary" disabled={!saved} onClick={() => setStep("password")}>
                Continue
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <input className="wl-input" type="password" placeholder="New password" value={p1} onChange={(e) => setP1(e.target.value)} />
          <input className="wl-input" type="password" placeholder="Confirm password" value={p2} onChange={(e) => setP2(e.target.value)} />
          <button type="button" className="wl-btn wl-btn-primary" disabled={busy} onClick={encrypt}>
            {busy ? "Encrypting…" : "Protect my wallet"}
          </button>
        </>
      )}
      {err && <p className="pw-err">{err}</p>}
    </div>
  );
}

function ChangePassword() {
  const [oldP, setOldP] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const go = async () => {
    setMsg(null);
    if (p1.length < 8) return setMsg("Use at least 8 characters.");
    if (p1 !== p2) return setMsg("The two new passwords don’t match.");
    setBusy(true);
    try {
      await changePassphrase(oldP, p1);
      setOldP(""); setP1(""); setP2("");
      setMsg("Password changed. ✓");
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  };

  return (
    <div className="pw-box">
      <input className="wl-input" type="password" placeholder="Current password" value={oldP} onChange={(e) => setOldP(e.target.value)} />
      <input className="wl-input" type="password" placeholder="New password" value={p1} onChange={(e) => setP1(e.target.value)} />
      <input className="wl-input" type="password" placeholder="Confirm new password" value={p2} onChange={(e) => setP2(e.target.value)} />
      <button type="button" className="wl-btn wl-btn-primary" disabled={busy} onClick={go}>
        {busy ? "Changing…" : "Change password"}
      </button>
      {msg && <p className="pw-msg">{msg}</p>}
    </div>
  );
}

export function PasswordPanel() {
  const [st, setSt] = useState<WalletStatus | null>(null);
  const [mode, setMode] = useState<AskMode>(getAskMode());
  const [rememberPass, setRememberPass] = useState("");
  const [rememberMsg, setRememberMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setSt(await walletStatus());
    } catch {
      /* keep last */
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  const pickMode = (m: AskMode) => {
    setMode(m);
    setAskMode(m);
  };

  const toggleRemember = async () => {
    setRememberMsg(null);
    try {
      if (st?.remembered) {
        await forgetPassword();
      } else {
        if (!rememberPass) return setRememberMsg("Enter your wallet password to save it.");
        await rememberPassword(rememberPass);
        setRememberPass("");
      }
      await refresh();
    } catch (e) {
      setRememberMsg(String(e));
    }
  };

  return (
    <section className="set-section">
      <h3 className="set-title">Password</h3>

      {st === null ? (
        <p className="wl-empty">Checking wallet…</p>
      ) : !st.encrypted ? (
        <>
          <p className="set-note">
            Your wallet isn’t password-protected yet. Setting a password encrypts your private keys
            on this device so no one can spend your coins without it.
          </p>
          <SetPassword onDone={refresh} />
        </>
      ) : (
        <>
          <p className="set-note">
            Your wallet is encrypted. It can stake in the background 24/7 while still requiring your
            password to send.
          </p>

          <h4 className="pw-sub">Change password</h4>
          <ChangePassword />

          <h4 className="pw-sub">When to ask for the password</h4>
          <div className="pw-modes">
            {MODES.map((m) => (
              <label key={m.id} className={"pw-mode" + (mode === m.id ? " pw-mode-on" : "")}>
                <input type="radio" name="askmode" checked={mode === m.id} onChange={() => pickMode(m.id)} />
                <span className="pw-mode-label">{m.label}</span>
                <span className="pw-mode-hint">{m.hint}</span>
              </label>
            ))}
          </div>

          <h4 className="pw-sub">Remember password on this device</h4>
          <p className="set-note">
            Lets staking resume silently when you open the app. Convenient, but the password is
            retrievable to anyone who gains access to this computer. Stored in your operating
            system’s secure store (Keychain / Credential Manager / Secret Service).
          </p>
          {st.remembered ? (
            <button type="button" className="wl-btn" onClick={toggleRemember}>
              Forget saved password
            </button>
          ) : (
            <div className="pw-box">
              <input className="wl-input" type="password" placeholder="Wallet password" value={rememberPass} onChange={(e) => setRememberPass(e.target.value)} />
              <button type="button" className="wl-btn" onClick={toggleRemember}>
                Save on this device
              </button>
            </div>
          )}
          {rememberMsg && <p className="pw-msg">{rememberMsg}</p>}
        </>
      )}

      <h4 className="pw-sub">Two-factor (2FA)</h4>
      <p className="set-note pw-soon">
        Email / DiviGo two-factor is planned. Note it protects the app, not the keys — anyone with
        your wallet file and password bypasses it — and it needs an email/DiviGo backend, so it’s a
        later add.
      </p>
    </section>
  );
}
