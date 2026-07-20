// Every icon is a CSS variable (--icon-<name>), never hardcoded in a component.
// A skin can override any of them — that's why icons live in the styling layer.
// The <Icon> component just masks the current text color through --icon-<name>,
// so icons recolor with the theme and swap with a skin.

const svg = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`
  )}")`;

// Default icon set (placeholders — a skin replaces these). Names mirror the
// current Divi Desktop wallet's operations.
export const ICONS: Record<string, string> = {
  overview: svg(
    "<rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='14' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/>"
  ),
  send: svg("<path d='M22 2 11 13'/><path d='M22 2 15 22 11 13 2 9Z'/>"),
  receive: svg("<path d='M12 3v12'/><path d='M7 10l5 5 5-5'/><path d='M4 20h16'/>"),
  history: svg("<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>"),
  addressbook: svg(
    "<rect x='3' y='4' width='18' height='16' rx='2'/><circle cx='9' cy='11' r='2.4'/><path d='M5.5 17c.8-2 2-3 3.5-3s2.7 1 3.5 3'/><path d='M15 10h3'/><path d='M15 14h3'/>"
  ),
  settings: svg(
    "<path d='M4 6h9'/><path d='M17 6h3'/><path d='M4 18h3'/><path d='M11 18h9'/><circle cx='15' cy='6' r='2.2'/><circle cx='7' cy='18' r='2.2'/>"
  ),
  gear: svg(
    "<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/>"
  ),
  copy: svg("<rect x='9' y='9' width='11' height='11' rx='2'/><path d='M5 15V5a2 2 0 0 1 2-2h10'/>"),
  timestamp: svg(
    "<path d='M14 2H7a2 2 0 0 0-2 2v6'/><path d='M14 2v5h5'/><path d='M19 7v3'/><circle cx='11.5' cy='16.5' r='5.5'/><path d='M11.5 14v2.5l1.7 1'/>"
  ),
  collectibles: svg(
    "<path d='M6 3h12l4 6-10 12L2 9Z'/><path d='M2 9h20'/><path d='M12 3 8 9l4 12 4-12-4-6'/>"
  ),
  tokens: svg(
    "<ellipse cx='12' cy='6' rx='8' ry='3'/><path d='M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6'/><path d='M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'/>"
  ),
  note: svg("<path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/>"),
  external: svg("<path d='M15 3h6v6'/><path d='M10 14 21 3'/><path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/>"),
  refresh: svg("<path d='M21 12a9 9 0 1 1-2.64-6.36'/><path d='M21 3v6h-6'/>"),
  globe: svg("<circle cx='12' cy='12' r='9'/><path d='M3 12h18'/><path d='M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18'/>"),
};

// Set the default icon vars on :root. A skin later overrides any --icon-<name>.
export function applyIcons(): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(ICONS)) {
    root.style.setProperty(`--icon-${name}`, value);
  }
}
