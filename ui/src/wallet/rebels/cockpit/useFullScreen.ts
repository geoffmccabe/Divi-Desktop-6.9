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

import { platform } from "../platform/current";

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
    /* A window made full screen by the app fires no document event, and the
       user can leave it by the window's own controls, so it is also asked
       now and then. Twice a second is far below anything a person notices and
       far above anything that costs. */
    const door = platform().screen;
    let asking = false;
    const poll = door
      ? setInterval(() => {
        /* Never two at once: this crosses to the app over its own channel, and
           stacking requests on a busy frame is how a poll becomes a stall. */
        if (asking) return;
        asking = true;
        void door.isFull()
          .then(setFullScreen)
          .catch(() => {})
          .finally(() => { asking = false; });
      }, 1000)
      : null;
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (poll) clearInterval(poll);
    };
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (typeof document === "undefined") return;
    void (async () => {
      /* ---- THE DOOR FIRST ----
         Inside the desktop app the browser's own request does nothing: a
         WKWebView takes it and ignores it, which is why the button appeared to
         be dead. The app has a WINDOW, and its door knows how to make a window
         full screen. The browser API is the right answer on the web and the
         fallback everywhere else. */
      const door = platform().screen;
      try {
        if (door) {
          const now = await door.isFull();
          await door.setFull(!now);
          setFullScreen(await door.isFull());
          return;
        }
      } catch { /* fall through to the browser's own */ }
      try {
        /* The whole page, not the canvas: the cockpit's gauges, cards and
           panels are ordinary elements over it, and asking for the canvas alone
           would leave every one of them behind. */
        if (isFull()) await document.exitFullscreen?.();
        else await document.documentElement.requestFullscreen?.();
        setFullScreen(isFull());
      } catch {
        /* Refused, or unsupported. The icon stays as it was, because nothing
           changed. */
      }
    })();
  }, []);

  return { fullScreen, toggleFullScreen };
}
