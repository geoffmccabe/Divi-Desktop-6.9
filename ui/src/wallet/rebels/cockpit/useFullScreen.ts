// Full screen, and back out of it again.
//
// Geoff: "I want you to add a small icon for 'full screen' to the right of the
// ESC BACK TO MAP button. When clicked then the game goes completely full
// screen. And then there's a button in the bottom right after that on the full
// screen version, to collapse it back into the app version again."
//
// The browser owns this, not the game: asking for full screen is a request
// that can be refused, and the user can leave it by other means (Escape, the
// window controls, swiping away). So the button never assumes it worked. It
// asks, and then it believes only what the browser reports.

import { useCallback, useEffect, useState } from "react";

/** Is the page full screen right now? Asked of the document, not remembered. */
function isFull(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.fullscreenElement;
}

export function useFullScreen(): { fullScreen: boolean; toggleFullScreen: () => void } {
  const [fullScreen, setFullScreen] = useState(isFull);

  /* The browser is the authority. Escape leaves full screen without going
     anywhere near the button, and so does the window's own control, so the
     icon follows the document rather than the last click. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setFullScreen(isFull());
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (typeof document === "undefined") return;
    try {
      if (isFull()) void document.exitFullscreen?.();
      /* The whole page, not the canvas: the cockpit's gauges, cards and panels
         are ordinary elements over it, and asking for the canvas alone would
         leave every one of them behind. */
      else void document.documentElement.requestFullscreen?.();
    } catch {
      /* Refused, or unsupported. The icon stays as it was, because the
         document did. */
    }
  }, []);

  return { fullScreen, toggleFullScreen };
}
