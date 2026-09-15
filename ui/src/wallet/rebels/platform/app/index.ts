// The desktop app's door.
//
// Every answer here is what the game already did inside the wallet before the
// game and the wallet were separated, calling the very same functions. Nothing
// is new: it is the old behaviour, moved to the one place allowed to reach into
// the wallet. The web door (Stage B) answers the same questions differently.

import type { RebelsPlatform } from "../platform";
import { DEFAULT_ROOM_BASE, DESKTOP_DETAIL, LOCAL_STORAGE, NO_LIMITS } from "../defaults";
import { desktopInput } from "../desktopInput";
import { appIdentity } from "./identity";
import { userWonRecently } from "../../../stakeWin";
import { fetchPrices } from "../../../value";
import { validateAddress, walletAddresses } from "../../../api";
import { PurchaseWithDivi } from "../../../../points/PurchaseWithDivi";
import { createCheats } from "../../rebelsCheats";

export const appPlatform: RebelsPlatform = {
  id: "app",
  identity: appIdentity,
  storage: LOCAL_STORAGE,
  limits: NO_LIMITS,
  roomBase: DEFAULT_ROOM_BASE,
  wonStakeRecently: (windowMs?: number) => userWonRecently(windowMs),
  prices: { fetch: () => fetchPrices() },
  money: {
    validateAddress: (address: string) => validateAddress(address),
    ownAddresses: () => walletAddresses(),
    PayWithDivi: PurchaseWithDivi,
  },
  detail: DESKTOP_DETAIL,
  input: desktopInput,
  /* The test cheats, for testing in the app. */
  cheats: createCheats,
};
