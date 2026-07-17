// Placeholder until 4b. Sending real, irreversible DIVI gets built with full
// address/amount validation, a clear confirmation, and just-in-time unlock.
export function SendPanel() {
  return (
    <div className="wl-stub">
      <p>Sending DIVI is the next step.</p>
      <p className="wl-note">
        It will validate the destination and amount, show a clear confirmation of exactly what's
        leaving and where, and unlock the wallet only for the moment of sending — because a send
        can't be undone.
      </p>
    </div>
  );
}
