import { PasswordPanel } from "./PasswordPanel";
import { CoinMaturity } from "./CoinMaturity";

export function SettingsView() {
  return (
    <div className="settings-view">
      <PasswordPanel />
      <CoinMaturity />
      <section className="set-section">
        <h3 className="set-title">Appearance</h3>
        <p className="set-note">
          For appearance and skins, open the Style editor with the gear in the bottom-right corner.
        </p>
      </section>
    </div>
  );
}
