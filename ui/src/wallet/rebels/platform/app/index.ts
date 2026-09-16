// The desktop app's door.
//
// Every answer here is what the game already did inside the wallet before the
// game and the wallet were separated, calling the very same functions. Nothing
// is new: it is the old behaviour, moved to the one place allowed to reach into
// the wallet. The web door (Stage B) answers the same questions differently.

import type { RebelsPlatform } from "../platform";
import { DEFAULT_ACCOUNT, DEFAULT_ROOM_BASE, DESKTOP_DETAIL, LOCAL_STORAGE, NO_LIMITS } from "../defaults";
import { desktopInput } from "../desktopInput";
import { appIdentity } from "./identity";
import { userWonRecently } from "../../../stakeWin";
import { fetchPrices } from "../../../value";
import { validateAddress, walletAddresses, walletBalance } from "../../../api";

/** What Tauri puts on the window when the app is built with withGlobalTauri.
 *  Declared narrowly here rather than imported, so the game keeps its promise
 *  of not reaching into the app's own modules. */
interface TauriWindows {
  __TAURI__?: {
    window?: {
      getCurrentWindow?: () => {
        isFullscreen(): Promise<boolean>;
        setFullscreen(on: boolean): Promise<void>;
      };
    };
  };
}
import { PurchaseWithDivi } from "../../../../points/PurchaseWithDivi";
import { createCheats } from "../../rebelsCheats";

export const appPlatform: RebelsPlatform = {
  id: "app",
  identity: appIdentity,
  storage: LOCAL_STORAGE,
  limits: NO_LIMITS,
  account: DEFAULT_ACCOUNT,
  roomBase: DEFAULT_ROOM_BASE,
  wonStakeRecently: (windowMs?: number) => userWonRecently(windowMs),
  prices: { fetch: () => fetchPrices() },
  money: {
    validateAddress: (address: string) => validateAddress(address),
    ownAddresses: () => walletAddresses(),
    PayWithDivi: PurchaseWithDivi,
    /* What is in the wallet, for the respawn ladder. EVERYTHING it reports, not
       just the spendable part: Geoff said "how much Divi the user has in the
       wallet", and a holder with twenty million has most of it staking. */
    walletDivi: async () => {
      try {
        const b = await walletBalance();
        if (!b) return null;
        const n = (b.spendable ?? 0) + (b.staking ?? 0) + (b.pending ?? 0) + (b.immature ?? 0);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    },
  },
  /* ---- full screen, the app's way ----
     The browser's requestFullscreen does nothing useful inside this webview.
     The app has a window, and Tauri exposes it on the global because the app is
     built with withGlobalTauri. Everything is guarded: if the shape is not
     there, the button's own fallback uses the browser API instead. */
  screen: {
    isFull: async () => {
      try {
        const w = (window as unknown as TauriWindows).__TAURI__?.window?.getCurrentWindow?.();
        return w ? await w.isFullscreen() : !!document.fullscreenElement;
      } catch { return !!document.fullscreenElement; }
    },
    setFull: async (on: boolean) => {
      const w = (window as unknown as TauriWindows).__TAURI__?.window?.getCurrentWindow?.();
      if (w) { await w.setFullscreen(on); return; }
      if (on) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    },
  },
  detail: DESKTOP_DETAIL,
  input: desktopInput,
  /* The test cheats, for testing in the app. */
  cheats: createCheats,
};
