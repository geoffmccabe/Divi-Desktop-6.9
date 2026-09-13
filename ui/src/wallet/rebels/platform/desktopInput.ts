// Keyboard and mouse: the cockpit's listeners, exactly as they always were.
//
// Moved here verbatim from rebelsController.ts so the listening is a door's
// choice. Same events, same targets, same options. The handlers themselves
// stay in the controller; this only plugs them in and pulls them out.

import type { CockpitHandlers, RebelsInput } from "./platform";

export const desktopInput: RebelsInput = {
  attach(dom: HTMLCanvasElement, h: CockpitHandlers): () => void {
    dom.addEventListener("wheel", h.wheel, { passive: false });
    dom.addEventListener("pointerleave", h.pointerleave);
    dom.addEventListener("pointermove", h.pointermove);
    dom.addEventListener("pointerdown", h.pointerdown);
    dom.addEventListener("contextmenu", h.contextmenu);
    window.addEventListener("pointerup", h.pointerup);
    window.addEventListener("keydown", h.keydown);
    window.addEventListener("keyup", h.keyup);
    window.addEventListener("blur", h.blur);
    window.addEventListener("focus", h.focus);
    if (typeof document !== "undefined") {
      document.addEventListener("pointerlockchange", h.pointerlockchange);
    }
    return () => {
      dom.removeEventListener("wheel", h.wheel);
      dom.removeEventListener("pointerleave", h.pointerleave);
      dom.removeEventListener("pointermove", h.pointermove);
      dom.removeEventListener("pointerdown", h.pointerdown);
      dom.removeEventListener("contextmenu", h.contextmenu);
      window.removeEventListener("pointerup", h.pointerup);
      window.removeEventListener("keydown", h.keydown);
      window.removeEventListener("keyup", h.keyup);
      window.removeEventListener("blur", h.blur);
      window.removeEventListener("focus", h.focus);
      if (typeof document !== "undefined") {
        document.removeEventListener("pointerlockchange", h.pointerlockchange);
      }
    };
  },
};
