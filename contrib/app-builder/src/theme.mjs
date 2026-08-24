// The wallet's look, described for whoever is writing an app.
//
// Geoff's requirement: an app developer should not have to think about styling
// at all, and whatever they build must follow the wallet's skins automatically.
//
// The way that works is that every colour, font, radius and blur in the wallet
// is a CSS variable, and the frame an app runs in inherits them. So an app that
// uses `hsl(var(--primary))` is themed for free, on every skin, including skins
// nobody has made yet. An app that writes `#7c3aed` is stuck looking like
// today's default for ever.
//
// This list is sent with every build request. There is a test that reads the
// wallet's own token file and fails if a variable is added there without being
// described here, so the two cannot drift apart.

export const THEME_VARS = [
  ["--background", "the window behind everything"],
  ["--foreground", "normal text"],
  ["--primary", "the main accent; buttons, highlights"],
  ["--accent", "a second accent, used sparingly"],
  ["--card", "a raised panel"],
  ["--panel-bg", "the panel surface colour"],
  ["--border", "lines between things"],
  ["--success", "something worked"],
  ["--warning", "be careful"],
  ["--destructive", "something is wrong, or will delete"],
  ["--font-heading", "headings"],
  ["--font-body", "body text"],
  ["--font-mono", "numbers, addresses, code"],
  ["--panel-radius", "how round a panel is"],
  ["--panel-blur", "the frosted-glass blur behind a panel"],
  ["--panel-opacity", "how solid a panel is"],
  ["--glow-color", "the colour of a glow around a focused thing"],
  ["--glow-strength", "how strong that glow is"],
  ["--control-scheme", "light or dark, for native controls like scrollbars and inputs"],
  ["--subpanel-bg", "a panel inside a panel"],
  ["--subpanel-opacity", "how solid an inner panel is"],
  ["--subpanel-outline-color", "an inner panel's edge"],
  ["--subpanel-outline-width", "how thick that edge is (often zero)"],
  ["--app-card-radius", "corner rounding used by Community Apps"],
  ["--app-grid-gap", "spacing used by Community Apps"],
  ["--app-card-min", "card width in Community Apps"],
  ["--app-card-glow", "hover glow strength"],
  ["--purchase-modal-width", "the Purchase with Divi window"],
  ["--purchase-mascot-size", "the mascot beside a purchase"],
  ["--sound-volume", "interface sound volume"],
  ["--sound-click-freq", "click sound pitch"],
  ["--sound-click-wave", "click sound shape"],
  ["--sound-send-freq", "send sound pitch"],
  ["--sound-send-wave", "send sound shape"],
  ["--sound-receive-freq", "receive sound pitch"],
  ["--sound-receive-wave", "receive sound shape"],
];

/**
 * The styling section of the build prompt.
 *
 * Deliberately blunt about the one rule that matters, because it is the rule a
 * model breaks by habit: colours come from variables, never from hex.
 */
export function stylingBrief() {
  const list = THEME_VARS.map(([v, why]) => `  ${v} — ${why}`).join("\n");
  return `STYLING — you do not need to design anything.

The app inherits the wallet's look. Every colour, font and shape arrives as a
CSS variable and follows whatever skin the person is using, including skins that
do not exist yet.

ONE RULE, and it matters more than anything else you do with CSS:
  Use the variables. Never write a hex colour, an rgb() or a named colour, and
  never name a font directly. A hex colour looks right today and wrong on every
  other skin, and the person cannot fix it.

Colours are HSL triplets, so they are used like this:
  color: hsl(var(--foreground));
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
and with transparency:
  color: hsl(var(--foreground) / 0.6);

Fonts and sizes are used directly:
  font-family: var(--font-body);
  border-radius: var(--panel-radius);

Available:
${list}

Keep the page background transparent — the wallet paints behind you. A frosted
panel is: background: hsl(var(--card) / var(--panel-opacity)); with
backdrop-filter: blur(var(--panel-blur)); and border-radius: var(--panel-radius);`;
}
