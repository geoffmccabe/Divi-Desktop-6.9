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
import { dflow } from "../rebelsDflow";

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
         fallback everywhere else.

         ---- AND IT SAYS WHAT HAPPENED ----
         Three attempts at this have now been reported as "the full screen
         button doesn't work", and every one of the reasons it could fail is
         invisible from here: a door that is not there, a window call the app
         has no permission for, a webview that takes the request and ignores
         it, or a window that really did go full screen while the page inside
         it stayed the size it was. They look identical to a player and they
         need completely different fixes, so each step is written into DFlow.
         One press and the next report says which it was. */
      const size = () => `${window.innerWidth}x${window.innerHeight}`;
      const before = size();
      const door = platform().screen;
      dflow.note(`full screen: asked for; door ${door ? "present" : "MISSING"}; page ${before}`);
      try {
        if (door) {
          const now = await door.isFull();
          await door.setFull(!now);
          const after = await door.isFull();
          setFullScreen(after);
          dflow.note(`full screen: the app's window went ${now} -> ${after}; page ${before} -> ${size()}`);
          /* The window obeying and the PAGE not following are different
             faults. If the window changed and the page did not, the layout is
             the problem, not the door, and nothing is gained by asking the
             webview as well. */
          if (after !== now) return;
          dflow.note("full screen: the window did not change, trying the browser's own");
        }
      } catch (err) {
        dflow.note(`full screen: the app's window REFUSED it: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        /* The whole page, not the canvas: the cockpit's gauges, cards and
           panels are ordinary elements over it, and asking for the canvas alone
           would leave every one of them behind. */
        if (isFull()) await document.exitFullscreen?.();
        else await document.documentElement.requestFullscreen?.();
        setFullScreen(isFull());
        dflow.note(`full screen: the browser says ${isFull()}; page ${before} -> ${size()}`);
      } catch (err) {
        dflow.note(`full screen: the browser REFUSED it too: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, []);

  return { fullScreen, toggleFullScreen };
}
