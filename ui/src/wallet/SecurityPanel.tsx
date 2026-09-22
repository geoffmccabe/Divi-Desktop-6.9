import { useEffect, useState } from "react";
import { listNodes } from "./api";
import { PasswordPanel } from "./PasswordPanel";
import { SeedPhrasePanel } from "./SeedPhrasePanel";
import { TwoFactorPanel } from "./TwoFactorPanel";

// Settings → Security. Three separate things that used to be one screen:
// the password (protects the copy of the wallet on this machine), the seed
// phrase (IS the wallet), and two-factor (locks the app).
//
// It also says WHICH wallet these settings belong to. DD69 can point at
// several nodes, each with its own wallet, and this screen gave no hint of
// which one it was showing. Geoff, 2026-Sep-21, pointed at a brand-new node
// with an unprotected wallet, reasonably read its first-time "set a password"
// flow as the app trying to reset the password on his own wallet.

export function SecurityPanel() {
  const [where, setWhere] = useState<string | null>(null);

  useEffect(() => {
    listNodes()
      .then((r) => setWhere(r.nodes.find((n) => n.id === r.active)?.label ?? r.active))
      .catch(() => setWhere(null));
  }, []);

  return (
    <div className="sec-wrap">
      <p className="sec-which">
        {where ? (
          <>
            These settings belong to the wallet on <strong>{where}</strong>. Each of your nodes has
            its own wallet, password and seed phrase.
          </>
        ) : (
          "Each of your nodes has its own wallet, password and seed phrase."
        )}
      </p>
      <div className="sec-grid">
        <PasswordPanel />
        <SeedPhrasePanel />
        <TwoFactorPanel />
      </div>
    </div>
  );
}
