import { AnimatedBackdrop } from "./AnimatedBackdrop";
import { StatusPill } from "./StatusPill";
import { WalletView } from "./wallet/WalletView";
import { ThemeProvider } from "./theme/ThemeProvider";
import { AdminGear } from "./admin/AdminGear";

export default function App() {
  return (
    <ThemeProvider>
      <AnimatedBackdrop />
      <main className="app-main">
        <header className="app-header">
          <div className="app-title">
            <h1>Divi Desktop</h1>
            <span className="ver">6.9</span>
          </div>
          <StatusPill />
        </header>
        <div className="app-body">
          <WalletView />
        </div>
      </main>
      <AdminGear />
    </ThemeProvider>
  );
}
