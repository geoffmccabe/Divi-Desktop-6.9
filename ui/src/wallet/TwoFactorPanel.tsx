// Two-factor: its own panel, and honest about where it stands. Not built yet.
// The wording matters more than usual here, because a security feature that
// promises more than it delivers is worse than none.

export function TwoFactorPanel() {
  return (
    <section className="set-section sec-card">
      <h3 className="set-title">Two-Factor (2FA)</h3>
      <p className="set-note pw-soon">
        Not built yet. The plan is a six-digit code from an authenticator app on your phone
        (Google Authenticator, Authy and the like), asked for before sending, before showing the
        seed phrase, and before changing the password.
      </p>
      <p className="set-note">
        Worth knowing what it will and will not do. It locks this app. It does not lock the coins
        themselves: someone who has your wallet file and your password can bypass the app
        entirely. The protection for the coins is your password and your seed phrase being kept
        safe, and, for large amounts, a multi-signature wallet where a second device has to
        approve every payment.
      </p>
    </section>
  );
}
