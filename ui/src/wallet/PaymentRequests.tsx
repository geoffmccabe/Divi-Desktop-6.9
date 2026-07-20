import { useEffect, useState } from "react";
import {
  paymentRequestCreate,
  paymentRequestsInbox,
  sendCoins,
  walletAddresses,
  type PayRequest,
} from "./api";

// Payment requests: ask someone to pay you, and see what you've been asked for.
//
// A request is an INVITATION, never an authorisation. Receiving one moves no
// money; paying is always a separate, explicit act. The UI must never blur that
// line, so nothing here pays automatically and the amount is always shown
// before the button that sends it.
//
// NOTE: no em-dashes in user-facing strings. House rule.

const SATS = 100_000_000;
const fmtDivi = (sats: number) =>
  (sats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 });

const when = (t: number) => (t ? new Date(t * 1000).toLocaleString() : "");
const isExpired = (r: PayRequest) => r.expiry > 0 && r.expiry * 1000 < Date.now();

function Incoming({ r, onPaid }: { r: PayRequest; onPaid: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentTx, setSentTx] = useState<string | null>(null);
  const [amount, setAmount] = useState(r.amountSats ? String(r.amountSats / SATS) : "");

  const expired = isExpired(r);
  const open = r.amountSats === 0; // payer chooses the amount

  async function pay() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setErr("Enter an amount to send.");
      return;
    }
    if (!r.payToAddress) {
      setErr("This request doesn't carry a usable payment address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setSentTx(await sendCoins(r.payToAddress, value));
      onPaid();
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  }

  return (
    <li
      style={{
        border: "1px solid hsl(var(--border))",
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
        opacity: expired ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.05rem", fontWeight: 700 }}>
          {open ? "Any amount" : `${fmtDivi(r.amountSats)} DIVI`}
        </span>
        {expired && <span style={{ color: "hsl(var(--muted-foreground))" }}>expired</span>}
        <span style={{ marginLeft: "auto", fontSize: "0.7rem", opacity: 0.7 }}>{when(r.time)}</span>
      </div>

      {r.memo && <div style={{ fontSize: "0.82rem", marginTop: 4 }}>{r.memo}</div>}

      <div style={{ fontSize: "0.7rem", opacity: 0.75, marginTop: 4, wordBreak: "break-all" }}>
        Pays to {r.payToAddress ?? r.payTo}
      </div>

      {r.confirmations < 1 && (
        <div style={{ fontSize: "0.7rem", opacity: 0.75 }}>Waiting for a block before this is settled.</div>
      )}

      {sentTx ? (
        <div style={{ marginTop: 8, fontSize: "0.78rem", color: "hsl(var(--success))" }}>
          Sent. Transaction {sentTx.slice(0, 16)}…
        </div>
      ) : (
        !expired && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            {open && (
              <input
                className="wl-input"
                style={{ maxWidth: 140 }}
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
            <button className="wl-btn wl-btn-primary" disabled={busy} onClick={pay}>
              {busy ? "Sending…" : open ? "Pay" : `Pay ${fmtDivi(r.amountSats)} DIVI`}
            </button>
          </div>
        )
      )}
      {err && <p className="wl-err">{err}</p>}
    </li>
  );
}

export function PaymentRequests() {
  const [tab, setTab] = useState<"inbox" | "ask">("inbox");
  const [inbox, setInbox] = useState<PayRequest[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Ask form
  const [payer, setPayer] = useState("");
  const [payTo, setPayTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [sentTx, setSentTx] = useState<string | null>(null);

  const load = async () => {
    try {
      setInbox(await paymentRequestsInbox(100));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String(e));
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // Default the "pay to" box to one of our own addresses, since asking to be
  // paid somewhere else is the unusual case.
  useEffect(() => {
    walletAddresses()
      .then((a) => {
        const main = a.find((x) => x.isMain) ?? a[0];
        if (main) setPayTo((p) => p || main.address);
      })
      .catch(() => {});
  }, []);

  async function send() {
    const value = Number(amount || "0");
    if (!payer.trim()) {
      setAskErr("Enter the address you're asking to be paid by.");
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      setAskErr("That isn't a valid amount.");
      return;
    }
    const d = Number(days || "0");
    const expiry = d > 0 ? Math.floor(Date.now() / 1000) + Math.round(d * 86400) : 0;
    setBusy(true);
    setAskErr(null);
    try {
      setSentTx(await paymentRequestCreate(payer.trim(), payTo.trim(), value, expiry, memo));
      setAmount("");
      setMemo("");
    } catch (e) {
      setAskErr(String(e));
    }
    setBusy(false);
  }

  const pending = inbox?.filter((r) => !isExpired(r)).length ?? 0;

  return (
    <div className="poe-pane">
      <nav className="poe-tabs" role="tablist">
        <button
          className={"poe-tab" + (tab === "inbox" ? " poe-tab-on" : "")}
          onClick={() => setTab("inbox")}
          role="tab"
          aria-selected={tab === "inbox"}
        >
          Requests to me{pending ? ` (${pending})` : ""}
        </button>
        <button
          className={"poe-tab" + (tab === "ask" ? " poe-tab-on" : "")}
          onClick={() => setTab("ask")}
          role="tab"
          aria-selected={tab === "ask"}
        >
          Ask for payment
        </button>
      </nav>

      {tab === "inbox" && (
        <>
          <p className="wl-note">
            Requests other people have sent you. Nothing is ever paid on its own: you choose, every time.
          </p>
          {loadErr && <p className="wl-err">{loadErr}</p>}
          {inbox === null ? (
            <p className="wl-note">Looking…</p>
          ) : inbox.length === 0 ? (
            <p className="wl-empty">No payment requests yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
              {inbox.map((r) => (
                <Incoming key={r.txid} r={r} onPaid={load} />
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "ask" && (
        <>
          <p className="wl-note">
            Send someone a request. It arrives in their wallet as a normal incoming transaction carrying your note, so
            they can pay it with one click. Sending costs a small fee.
          </p>

          <label className="wl-label">Ask this address to pay</label>
          <input
            className="wl-input"
            placeholder="Their Divi address"
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
          />

          <label className="wl-label">Send the money to</label>
          <input
            className="wl-input"
            placeholder="Your Divi address"
            value={payTo}
            onChange={(e) => setPayTo(e.target.value)}
          />

          <label className="wl-label">Amount (leave blank to let them choose)</label>
          <input
            className="wl-input"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <label className="wl-label">What's it for?</label>
          <input
            className="wl-input"
            placeholder="Invoice 42, rent for July, …"
            maxLength={400}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />

          <label className="wl-label">Expires after (days, 0 for never)</label>
          <input className="wl-input" style={{ maxWidth: 120 }} value={days} onChange={(e) => setDays(e.target.value)} />

          <button className="wl-btn wl-btn-primary" disabled={busy} onClick={send} style={{ marginTop: 10 }}>
            {busy ? "Sending…" : "Send request"}
          </button>
          {askErr && <p className="wl-err">{askErr}</p>}
          {sentTx && (
            <p style={{ color: "hsl(var(--success))", fontSize: "0.8rem" }}>
              Request sent. Transaction {sentTx.slice(0, 16)}…
            </p>
          )}

          <p className="wl-note" style={{ marginTop: 10, fontSize: "0.68rem", opacity: 0.75 }}>
            Requests are public: the amount, the note and both addresses are written on the chain where anyone can read
            them. Don't put anything private in the note.
          </p>
        </>
      )}
    </div>
  );
}
