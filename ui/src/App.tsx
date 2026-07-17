import { AnimatedBackdrop } from "./AnimatedBackdrop";
import { Shell } from "./Shell";
import { ThemeProvider } from "./theme/ThemeProvider";
import { AdminGear } from "./admin/AdminGear";

export default function App() {
  return (
    <ThemeProvider>
      <AnimatedBackdrop />
      <Shell />
      <AdminGear />
    </ThemeProvider>
  );
}
