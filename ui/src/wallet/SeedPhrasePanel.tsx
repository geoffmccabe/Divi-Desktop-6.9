import { useEffect, useRef, useState } from "react";
import { walletSeed, walletSeedUnlock, walletStatus, type WalletStatus } from "./api";

// Seed Phrase: its own panel, because it is its own thing. The seed is the
// wallet. The password only protects the copy of it on this machine. They
// used to share a screen in which the ONLY place the seed could be seen was
// inside the first-time "set a password" flow, so a wallet that already had a
// password had no way to show its seed at all, and a wallet without one made
// viewing the seed look like a demand to set a password.

const HIDE_AFTER_MS = 60_000;

export function SeedPhrasePanel() {
  const [st, setSt] = useState<WalletStatus | null>(null);
  const [pass, setPass] = useState("");
  const [seed, setSeed] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    walletStatus().then(setSt).catch(() => setSt(null));
    return () => window.clearTimeout(hideTimer.current);
  }, []);

  const hide = () => {
    window.clearTimeout(hideTimer.current);
    setSeed(null);
  };

  // A wallet we could not read is treated as protected: ask for the password.
  const needsPass = !st || st.known === false || st.encrypted;

  const show = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const words = needsPass ? await walletSeedUnlock(pass) : await walletSeed();
      setSeed(words);
      setPass("");
      // Never left on screen indefinitely.
      hideTimer.current = window.setTimeout(() => setSeed(null), HIDE_AFTER_MS);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="set-section sec-card">
      <h3 className="set-title">Seed Phrase</h3>
      <p className="set-note">
        These words ARE the wallet. Anyone who has them can take every coin in it, from any
        computer, without your password. Write them on paper and keep the paper somewhere safe.
        Never type them into a website, a chat, or a photo.
      </p>

      {seed ? (
        <>
          <div className="pw-seed">{seed}</div>
          <p className="pw-msg">Hidden again automatically after one minute.</p>
          <button type="button" className="wl-btn" onClick={hide}>
            Hide
          </button>
        </>
      ) : (
        <form
          className="pw-box"
          onSubmit={(e) => {
            e.preventDefault();
            void show();
          }}
        >
          {needsPass && (
            <input
              className="wl-input"
              type="password"
              placeholder="Wallet password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
          <button type="submit" className="wl-btn" disabled={busy || (needsPass && !pass)}>
            {busy ? "Reading…" : "Show my seed phrase"}
          </button>
        </form>
      )}
      {msg && <p className="pw-msg">{msg}</p>}
      <p className="pw-msg">
        There is no copy button here on purpose: a seed phrase on the clipboard can be read by any
        other program on the computer.
      </p>
    </section>
  );
}
