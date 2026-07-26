// Pin Code Send (keybound PIN). The redeem script and claim flow are the next
// backend piece to build; this panel is an honest placeholder so the four send
// types are laid out, without faking a working form. See the design in
// /Users/geoffreymccabe/.claude/.../project_divi_bearer_pin_send.md.
export function PinCodeSendPanel() {
  return (
    <div className="send-panel pincode-soon">
      <p className="wl-note">
        Locks the coins to your friend's address <em>and</em> behind a 6-digit PIN you share separately. They enter the
        PIN to claim; if they never do, a timelock refunds you. Two independent factors, so a swapped address or a
        leaked PIN alone can't take the money.
      </p>
      <span className="pincode-chip">Building next</span>
      <p className="wl-note pincode-sub">
        The claim script and unlock flow are the next piece. This panel is a placeholder so the layout is set; it does
        not send yet.
      </p>
    </div>
  );
}
