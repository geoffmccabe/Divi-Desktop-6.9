import { useEffect } from "react";
import { createPortal } from "react-dom";

// The "what is this actually for?" modal behind the (?) button. Proof of
// Existence is unfamiliar to most people, and the value only lands once you see
// concrete situations, so this leads with those rather than with the mechanism.

const USE_CASES: { title: string; body: string }[] = [
  {
    title: "A signed legal document",
    body:
      "Timestamp a contract, agreement or will the day it's signed. If anyone later disputes " +
      "when it was agreed, or claims a different version was signed, the proof settles it.",
  },
  {
    title: "Photos of damage",
    body:
      "Damage to a car, a rental property, a delivered package or belongings. Photographs are " +
      "easy to dispute as taken later; a timestamp shows the damage existed by that date — " +
      "useful for insurance claims and deposit disputes.",
  },
  {
    title: "Artwork, for copyright",
    body:
      "A digital piece, or a photo of handmade work. Copyright exists from creation, but proving " +
      "WHEN you created something is the hard part in a dispute. This gives you a dated record " +
      "without publishing the work or registering it anywhere.",
  },
  {
    title: "Writing, music and designs",
    body:
      "Manuscripts, lyrics, recordings, logos, product designs. Timestamp each draft and you " +
      "build a dated trail showing the work evolving in your hands.",
  },
  {
    title: "Inventions and prior art",
    body:
      "Timestamp a design or technical description before disclosing it. Establishes you had " +
      "the idea by a given date.",
  },
  {
    title: "Business records",
    body:
      "Accounts, audit logs, board minutes, valuations. Proves a record hasn't been quietly " +
      "edited after the fact.",
  },
];

export function PoeInfoModal({ onClose }: { onClose: () => void }) {
  // Escape closes, and the background is inert while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portalled to <body>: the app's main area is a .glass-panel, and
  // backdrop-filter makes an element the containing block for position:fixed
  // descendants — so a modal left in place would be positioned against that
  // panel rather than the window, and land off-screen.
  return createPortal(
    <div className="poe-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="poe-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="About Proof of Existence"
      >
        <div className="poe-modal-head">
          <h3>Proof of Existence</h3>
          <button className="wl-btn poe-modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="poe-modal-body">
          <p>
            Proof of Existence lets you prove a file existed on a certain date — without showing
            anyone the file, and without trusting any company to vouch for you.
          </p>
          <p className="wl-note">
            Your file never leaves this computer. The wallet calculates a fingerprint of it (a
            SHA-256 hash — a short code that changes completely if even one pixel or character
            changes) and writes only that fingerprint to the Divi blockchain. The block it lands in
            carries a timestamp that nobody can alter afterwards.
          </p>
          <p className="wl-note">
            Later, anyone with the same file can recalculate the fingerprint and see it matches the
            one recorded on that date. If the file has been changed by even one byte, it won't
            match.
          </p>

          <h4 className="poe-modal-sub">What people use it for</h4>
          <ul className="poe-uses">
            {USE_CASES.map((u) => (
              <li key={u.title}>
                <strong>{u.title}</strong>
                <span>{u.body}</span>
              </li>
            ))}
          </ul>

          <h4 className="poe-modal-sub">What it does and doesn't prove</h4>
          <p className="wl-note">
            <strong>It proves:</strong> this exact file existed no later than the date on the block.
            Nobody can backdate it, including you, and the record can't be deleted or edited.
          </p>
          <p className="wl-note">
            {/* Being straight about the limits matters more than overselling — a
                user who over-relies on this in a real dispute would be let down. */}
            <strong>It does not prove:</strong> who created the file, that you own it, or that
            anything written in it is true. It's evidence of timing and integrity, not of
            authorship or ownership. Keep the original file safe — without it there is nothing to
            check the fingerprint against.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
