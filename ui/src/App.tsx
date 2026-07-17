import { AnimatedBackdrop } from "./AnimatedBackdrop";
import { Shell } from "./Shell";
import { ThemeProvider } from "./theme/ThemeProvider";

export default function App() {
  return (
    <ThemeProvider>
      <AnimatedBackdrop />
      <Shell />
    </ThemeProvider>
  );
}
