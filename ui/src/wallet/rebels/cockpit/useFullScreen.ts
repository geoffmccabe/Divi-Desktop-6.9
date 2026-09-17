// Full screen, for the GAME.
//
// Geoff: "I want you to add a small icon for 'full screen' to the right of the
// ESC BACK TO MAP button. When clicked then the game goes completely full
// screen. And then there's a button in the bottom right after that on the full
// screen version, to collapse it back into the app version again."
//
// And then, three versions later, the part I had been missing: "Yes, the APP is
// full screen, but the game is inside a smaller window within the app. So the
// game needs to come out of the app and become full screen."

import { useCallback, useEffect, useState } from "react";

import { platform } from "../platform/current";
import { dflow } from "../rebelsDflow";

/**
 * ---- WHAT "FULL SCREEN" MEANS HERE ----
 *
 * Three rounds of this were spent making the WINDOW full screen, and that was
 * never the ask. Geoff, on 69.9.57: "Yes, the APP is full screen, but the game
 * is inside a smaller window within the app. So the game needs to come out of
 * the app and become full screen." The window obeying changed nothing he could
 * see, because the game is a panel inside the shell with a sidebar beside it, a
 * header above it and padding round the lot.
 *
 * So full screen is the GAME's own mode, held here, applied as one class on the
 * root element. The shell's furniture stands aside (see .dd69-game-full in
 * index.css) and nothing in the tree moves, which matters more than it looks:
 * moving the canvas would tear down its WebGL context and restart the game.
 *
 * The window is asked to go full screen too, so the game reaches the edges of
 * the DISPLAY rather than of a window, but that is a bonus and never the
 * measure. It was the measure before, which is the other half of what Geoff
 * saw: "When I make the DD69 window full screen, then the full-screen button
 * disappears. So it thinks it's full screen when it isn't." Making the window
 * full screen yourself is not the game being full screen, and the button must
 * not vanish because of it.
 */
const FULL_CLASS = "dd69-game-full";

/** Put the game's own full-screen mode on, or take it off. */
function wearIt(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(FULL_CLASS, on);
}

/** Is the GAME full screen? Its own mode, not the window's. */
function isFull(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(FULL_CLASS);
}

export function useFullScreen(): { fullScreen: boolean; toggleFullScreen: () => void } {
  const [fullScreen, setFullScreen] = useState(isFull);

  /* Escape leaves it, which is what Escape is for and what a player will try
     first. The cockpit's own Escape takes you back to the map, so this only
     acts while the game is full and stops the key there. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isFull()) return;
      e.preventDefault();
      e.stopPropagation();
      wearIt(false);
      setFullScreen(false);
      void platform().screen?.setFull(false).catch(() => {});
    };
    /* On the way DOWN and before anything else, or the cockpit's own Escape
       handler would have backed out to the map first. */
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /* Taken off on the way out. A game that left the class behind would leave the
     whole wallet with no sidebar. */
  useEffect(() => () => { wearIt(false); }, []);

  const toggleFullScreen = useCallback(() => {
    const want = !isFull();
    wearIt(want);
    setFullScreen(want);
    dflow.note(`full screen: the game is now ${want ? "full" : "back in the app"}`);
    /* And the window too, so the game reaches the edge of the display rather
       than the edge of a window. Best effort in every sense: refused, missing
       or ignored, the game is already full screen inside the app either way,
       which is what was asked for. */
    void (async () => {
      const door = platform().screen;
      try {
        if (door) { await door.setFull(want); return; }
        if (want) await document.documentElement.requestFullscreen?.();
        else await document.exitFullscreen?.();
      } catch (err) {
        dflow.note(`full screen: the window would not follow (${err instanceof Error ? err.message : String(err)}), the game is full anyway`);
      }
    })();
  }, []);

  return { fullScreen, toggleFullScreen };
}
