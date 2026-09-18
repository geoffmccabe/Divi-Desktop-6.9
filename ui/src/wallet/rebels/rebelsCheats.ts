// The test cheats, as their own module.
//
// Moved out of rebelsController.ts (2026-Sep-15) so a door can leave them out
// entirely: the app door plugs them in for testing; the web door does not, so the
// public page carries no cheat code (checked by scripts/check-rebels-boundary.mjs),
// and the room refuses cheats from web guests as well.
//
// Everything below is the controller's code as it was, with its reach into the
// game replaced by the small CheatHost the controller hands over.

import type { CheatHost, RebelsCheats } from "./platform/platform";
import { weaponByKey } from "./weaponCatalog";

export function createCheats(host: CheatHost): RebelsCheats {
  /* ---- the cheat key ----
     Geoff's format: "!1#", where ! opens it, 1 says what to send, and # is the
     tier. So "!11" sends a fleet of twenty-four grey spheres and "!15" sends
     purple ones.

     Typed as a SEQUENCE rather than bound to a chord, because the digits are
     already the weapon keys and a chord would have to fight them. While a
     sequence is open the digits are swallowed, so tapping out a cheat never
     also swaps the guns out from under the player. It closes itself after four
     seconds so a stray exclamation mark cannot leave the weapon keys dead.

     Nothing it summons is worth anything: see the anti-cheat guard in
     rebelsCombat, which refuses a conjured drone its kill, its tier count and
     its DIVI. A key that makes enemies out of nothing must not also make
     money out of nothing. */
  let cheat = "";
  let cheatUntil = 0;
  function runCheat(code: string) {
    const kind = code[1];
    const tier = Number(code[2]);
    if (!host.flying()) return;
    /* The fight is the server's, so the server spawns these. */
    if (kind === "1" && tier >= 1 && tier <= 6) {
      host.sendToRoom(code.slice(1));
    } else if (kind === "2" && tier === 1) {
      /* ---- TEST: !21, the dragon, in front of you ----
         Thirty-five units ahead, crossing left to right so it can be seen
         and chased. It is a REAL dragon (it leaves its egg), so this is a
         way to mint eggs and must go, or be gated, before eggs are worth
         anything. Geoff asked for it to test, 2026-Sep-11. */
      host.sendToRoom("21");
    } else if (kind === "8" && tier >= 1 && tier <= 5) {
      /* ---- TEST: !8t, one wingman of tier t, opened ----
         Press it again for another, up to eight. Goes with the other test
         cheats and comes out with them. */
      host.addHeld(`drone${tier}`, 1);
      host.note(`DRONE T${tier} FITTED`);
    } else if (kind === "9" && tier >= 1 && tier <= 4) {
      /* ---- TEST: !9t, a Beam of tier t, owned ----
         Geoff asked for a Tier 1 beam to test with, 2026-Sep-13, so "!91".
         NINE, not three: the leading digit says WHAT is being summoned and the
         low digits are reserved for enemy kinds, one each. 1 is the fighter
         flock and 2 is the dragon, so 3 belongs to the next enemy type Geoff
         adds. Geoff: "!31 should be for spawning our third enemy type."
         The line has to be walked in order for the number key to select it, so
         everything below the tier asked for is granted too: the mini gun and
         any lower beams. Goes with the other test cheats and comes out with
         them: this is a free weapon and must be gated before weapons are worth
         anything. */
      host.grant("mini");
      for (let n = 1; n <= tier; n++) host.grant(`beam${n}`);
      const spec = weaponByKey(`beam${tier}`);
      host.note(`${(spec?.name ?? "BEAM").toUpperCase()} FITTED: PRESS ${spec?.slot ?? 3}`);
    } else if (kind === "7" && tier === 7) {
      /* ---- TEST: !77, a Rear Gun, opened, into the inventory ----
         Same caveat: a free item, to be removed with the one above. */
      host.addHeld("reargun", 1);
      /* Ship upgrades work once FITTED (shipFleet.ts), so the test gun goes on the
         ship being flown straight away, as a found one would after "Apply to Ship". */
      const fit = host.applyToShip(host.ship(), "reargun");
      host.note(fit.ok ? "REAR GUN FITTED: PRESS 7" : `REAR GUN IN INVENTORY: ${fit.why.toUpperCase()}`);
    }
  }

  return {
    /* The sequence: "!" opens it for four seconds, then two digits. While it is
       open the digits are swallowed, so tapping out a cheat never also swaps
       the guns out from under the player. */
    onKey(k: string, now: number): boolean {
      if (cheat && now > cheatUntil) cheat = "";
      if (k === "!") {
        cheat = "!";
        cheatUntil = now + 4000;
        return true;
      }
      if (cheat) {
        if (k >= "0" && k <= "9") {
          cheat += k;
          if (cheat.length >= 3) { runCheat(cheat); cheat = ""; }
          return true;
        }
        /* Anything else abandons it and is handled normally. */
        cheat = "";
      }
      return false;
    },
  };
}
