import { AnimatedBackdrop } from "./AnimatedBackdrop";
import { StatusPanel } from "./StatusPanel";

export default function App() {
  return (
    <>
      <AnimatedBackdrop />
      <main className="relative z-10 h-full flex flex-col">
        <header className="px-8 py-5 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold" style={{ color: "hsl(var(--foreground))" }}>
            Divi Desktop
          </h1>
          <span className="text-sm" style={{ color: "hsl(var(--primary))" }}>6.9</span>
        </header>

        <div className="flex-1 flex items-center justify-center px-8 pb-12">
          <StatusPanel />
        </div>
      </main>
    </>
  );
}
