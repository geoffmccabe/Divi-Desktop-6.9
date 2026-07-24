// Every icon is a CSS variable (--icon-<name>), never hardcoded in a component.
// A skin can override any of them — that's why icons live in the styling layer.
// The <Icon> component just masks the current text color through --icon-<name>,
// so icons recolor with the theme and swap with a skin.

const svg = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`
  )}")`;

// svgrepo "woman" (id 87671). Filled glyph — used both for the My Agent nav icon
// and the character silhouettes in the agent panel so the two always match.
// Exported so AgentPanel can draw the same shape without duplicating the path.
export const WOMAN_VIEWBOX = "-9.74 -9.74 506.48 506.48";
export const WOMAN_PATH =
  "M428.683,326.004c2.329-4.568,5.975-11.733,9.611-18.926c3.513-6.948,6.304-12.511,8.293-16.532 c1.142-2.31,2.087-4.246,2.739-5.621c1.331-2.81,2.588-5.464,0.849-8.849c-1.104-2.147-3.179-3.637-5.567-3.994 C409.836,266.887,395,242.787,395,191.5v-40C395,67.963,327.038,0,243.5,0S92,67.963,92,151.5v40 c0,51.287-14.836,75.387-49.613,80.583c-2.387,0.358-4.46,1.847-5.563,3.993c-1.74,3.385-0.482,6.039,0.849,8.849 c0.652,1.375,1.597,3.312,2.739,5.621c1.99,4.021,4.78,9.584,8.293,16.532c3.636,7.192,7.283,14.357,9.611,18.926 C44.419,339.142,36,357.687,36,377.957V455.5c0,17.369,14.131,31.5,31.5,31.5h352c17.369,0,31.5-14.131,31.5-31.5v-77.543 C451,357.687,442.581,339.142,428.683,326.004z M54.361,284.915c17.948-4.775,31.373-14.894,39.985-30.169 C102.861,239.643,107,218.955,107,191.5v-40C107,76.233,168.234,15,243.5,15S380,76.233,380,151.5v40 c0,34.689,5.699,80.959,52.638,93.419c-4.046,8.146-10.552,20.992-16.087,31.859c-6.186-3.73-13.019-6.583-20.364-8.346 l-26.578-6.379c-1.937-0.464-3.976-0.141-5.672,0.899c-1.696,1.041-2.91,2.713-3.373,4.648c-0.259,1.081-0.555,2.151-0.844,3.223 l-23.703-5.926c-1.259-0.314-2.489-0.77-3.66-1.354l-0.237-0.118c-5.626-2.813-9.121-8.469-9.121-14.759v-16.031 c24.529-21.901,40-53.743,40-89.136v-16c0-0.064-0.008-0.126-0.01-0.19c-0.004-0.149-0.01-0.297-0.023-0.447 c-0.009-0.105-0.021-0.208-0.034-0.312c-0.017-0.138-0.038-0.275-0.063-0.412c-0.021-0.114-0.045-0.227-0.071-0.339 c-0.028-0.122-0.059-0.243-0.094-0.364c-0.036-0.125-0.075-0.248-0.117-0.371c-0.036-0.104-0.073-0.208-0.114-0.312 c-0.053-0.135-0.111-0.267-0.172-0.399c-0.041-0.089-0.083-0.178-0.128-0.266c-0.072-0.14-0.149-0.276-0.229-0.41 c-0.03-0.051-0.054-0.104-0.086-0.154l-40-64c-2.154-3.448-6.664-4.55-10.167-2.487C310.76,97.588,217.358,152,131.5,152 c-4.142,0-7.5,3.357-7.5,7.5v24c0,35.393,15.471,67.235,40,89.136v16.031c0,6.29-3.495,11.945-9.116,14.756l-0.247,0.123 c-1.167,0.583-2.396,1.038-3.658,1.353l-23.7,5.925c-0.289-1.072-0.585-2.142-0.844-3.223c-0.463-1.936-1.676-3.607-3.373-4.648 c-1.696-1.04-3.734-1.363-5.672-0.899l-26.578,6.379c-7.345,1.763-14.178,4.616-20.364,8.346 C64.914,305.91,58.407,293.061,54.361,284.915z M139,166.875c75.38-2.47,151.625-41.112,173.938-53.323L348,169.65v13.85 c0,57.621-46.878,104.5-104.5,104.5S139,241.121,139,183.5V166.875z M179,288.667v-4.61C197.618,296.041,219.761,303,243.5,303 s45.882-6.959,64.5-18.943v4.61c0,12.009,6.672,22.805,17.418,28.178l0.239,0.119c2.145,1.071,4.408,1.908,6.725,2.487l22.513,5.629 c-7.746,18.875-20.25,35.734-36.304,48.591C297.083,390.896,271.117,400,243.5,400s-53.583-9.104-75.091-26.329 c-16.054-12.857-28.559-29.716-36.305-48.591l22.511-5.629c2.319-0.579,4.583-1.416,6.723-2.485l0.248-0.124 C172.328,311.472,179,300.676,179,288.667z M436,455.5c0,9.098-7.402,16.5-16.5,16.5h-352c-9.098,0-16.5-7.402-16.5-16.5v-77.543 c0-26.227,17.812-48.818,43.314-54.939l19.486-4.677c7.865,26.229,23.734,49.82,45.232,67.038 C183.229,404.757,212.438,415,243.5,415s60.271-10.243,84.467-29.621c21.498-17.218,37.367-40.81,45.232-67.038l19.486,4.677 C418.188,329.139,436,351.73,436,377.957V455.5z";

const filledIcon = (viewBox: string, path: string, strokeWidth = 0) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}' fill='#000'${
      strokeWidth ? ` stroke='#000' stroke-width='${strokeWidth}' stroke-linecap='round' stroke-linejoin='round'` : ""
    }><path d='${path}'/></svg>`
  )}")`;

// Default icon set (placeholders — a skin replaces these). Names mirror the
// current Divi Desktop wallet's operations.
export const ICONS: Record<string, string> = {
  overview: svg(
    "<rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='14' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/>"
  ),
  send: svg("<path d='M22 2 11 13'/><path d='M22 2 15 22 11 13 2 9Z'/>"),
  receive: svg("<path d='M12 3v12'/><path d='M7 10l5 5 5-5'/><path d='M4 20h16'/>"),
  speed: svg("<polygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2'/>"), // lightning = fastest nodes
  history: svg("<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>"),
  // svgrepo "woman" glyph, thicker variant (stroke 18.506 + padded viewBox).
  agent: filledIcon(WOMAN_VIEWBOX, WOMAN_PATH, 18.506),
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
