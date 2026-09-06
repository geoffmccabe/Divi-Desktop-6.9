# Vector Arcade Game in DD69: Feasibility Study

Date: 2026-Sep-05. Repo: /Users/geoffreymccabe/Divi-Desktop-6.9 (branch `main`, v69.6.8).
Question asked: can we put the 1983 Atari *Star Wars* arcade game, or *Battlezone*,
inside the wallet so someone can play it in the app?

Short answer: yes, the technical fit is unusually good, but not by taking either
game. We should write an original vector arcade game of our own, in the
Battlezone style, and ship it as the first real Community App.

---

## 1. What actually exists in open source

I searched for both games. Nothing is liftable.

### Battlezone

| Project | Language | License | State |
|---|---|---|---|
| `061375/Battlezone` | JavaScript | **none** | 7 stars, last touched 2018, custom hobby engine |
| `SebastienBellanger/battlezone` | CoffeeScript | **none** | 6 stars, last touched 2015 |
| `adamcumiskey/BattleZone` | C++ | **none** | student project, 2015, not web |
| `afg419/battlezone` | JavaScript | MIT | 1 star, 2016, p5.js student project |
| `BZFlag` | C++ | LGPL2 / MPL | Active and good, but it is a textured multiplayer tank game, not a vector game, and it is a desktop binary, not web |

"No license" is the important column. A public GitHub repo with no license file is
all-rights-reserved by default: we legally cannot ship it inside DD69, even though
we can read it. The one MIT project is a p5.js coursework build (its own code is
about 35KB, and it drags in 834KB of p5.js) and it is not really Battlezone: it has
fighters, mines and a mothership instead of the arcade roster. Useful as a
reference read, not as a starting point.

### Star Wars (Atari, 1983)

Worse. The real recreations are FPGA cores for MiSTer hardware
(`Videodr0me/Arcade-StarWars_MiSTer` and a fork adding Empire Strikes Back). Those
are Verilog for a physical chip and are useless to us. The browser "trench run"
projects that turn up are modern textured Three.js demos, not colour-vector
recreations, and mostly carry no license either. There is a PICO-8 remake, which
would need the PICO-8 runtime, which we cannot ship.

### The emulation route, and why it is dead

Running real arcade ROMs through a WASM MAME build fails three separate ways, any
one of which is fatal:

1. The ROMs are still in copyright. 1980 and 1983 works do not fall out of
   copyright for another fifty years. Bundling them in a wallet installer is
   straightforward infringement.
2. Our own Content Security Policy blocks it. `crates/app/tauri.conf.json` sets
   `worker-src 'none'` and no `wasm-unsafe-eval`, and the app sandbox policy
   (`APP_CSP` in `crates/supervisor/src/appbundle.rs`) is `default-src 'none'`
   with `connect-src 'none'`. An emulator needs exactly the things we deliberately
   took away. Punching holes in that policy to run a 1980 tank game is a bad trade.
3. Size. A MAME core plus ROMs is several megabytes, and the entire DD69 frontend
   today is one 4.0MB inline file.

---

## 2. The names are the problem, not the gameplay

Game mechanics are not protected. Names, logos, artwork and trade dress are.

* **Star Wars** belongs to Lucasfilm / Disney. This is the single most actively
  enforced entertainment trademark in the world. A crypto wallet shipping a game
  called Star Wars is asking for a takedown letter, and Geoff's name is on the
  company. Off the table.
* **Battlezone** was bought by Rebellion Developments out of the Atari bankruptcy
  in 2013, and current licensed products still carry "Battlezone (R) (C) 1980
  Atari Interactive, Inc." So the mark is live and jointly asserted. Also off the
  table as a name.

What we *can* do freely: green wireframe lines on black, a first-person tank on a
flat plain, a horizon with distant mountains, blocky obstacles, a radar sweep,
enemy tanks and a saucer, a cracked-glass hit effect. None of that is anyone's
property. It is a genre, the same way "vertical shooter" is.

**Recommendation: build an original game, call it something of ours.** Working
name ideas: *Divi Zone*, *Vector Run*, *Node Zone*, *Grid Assault*. The Divi brand
already leans hex-grid and neon, so a green-on-black vector game sits naturally
next to it.

---

## 3. Why the DD69 fit is genuinely good

This is the part that makes it attractive. We are not adding new machinery. The
machinery is already built and already proven, and it is currently empty.

The Community Apps runtime that shipped in July already does exactly what a game
needs:

* **A sandbox with its own origin.** Apps are served from `divi-app://<id>/` by
  `crates/app/src/community.rs` using a Tauri custom URI scheme, so each app gets
  its own document and its own CSP. This exists specifically because iframes built
  from inline content inherit the parent's policy and would have their scripts
  blocked.
* **Built-in apps are just files compiled into the binary.** Look at the
  `BUILTINS` table near the top of `crates/app/src/community.rs`. There are two
  today: `io.divi.sandbox-test` (the escape-test harness) and `io.divi.snapshot`
  (balance and chain at a glance). Each is a folder under
  `crates/app/src/community/` containing `index.html`, `manifest.json` and
  `thumb.svg`, and one entry in that table. A game would be a third folder and a
  third entry. That is the entire integration.
* **The app policy allows inline script.** `APP_CSP` gives apps
  `script-src 'self' 'unsafe-inline'` inside their own origin, so a
  self-contained single-file game runs with no build step and no bundler.
* **`connect-src 'none'`.** The game cannot phone home, cannot load a tracker,
  cannot leak anything. For a game we want offline anyway, this is free safety.
* **Immersive mode already exists.** `ui/src/apps/AppHost.tsx` reads
  `display.immersive` from the manifest and can collapse the sidebar and header so
  the app takes the whole window. An arcade game is the ideal case for the
  "on-demand" setting: play windowed, hit Full Window for the cabinet feel.
* **Per-app storage already exists.** `ui/src/apps/storage.ts` gives each app a
  namespaced key-value bucket (64KB per value, 512KB total, 200 keys). High score
  table, settings and control preferences fit with room to spare, and no
  permission grant is required.
* **Zero permissions needed.** The manifest permission list
  (`ui/src/apps/permissions.ts`) is all read-only wallet data. A game declares an
  empty list, so the broker refuses every wallet call by default. Nothing about
  the game can touch balances, keys or the node.

Two secondary wins:

* The Community Apps panel is currently empty on purpose and says so. A polished
  built-in game turns it from a promise into a shelf with something on it, and it
  proves the sandbox to third-party developers better than a test harness does.
* It doubles as the reference example for the App Builder: "here is a real app,
  built the way you will build yours."

### Rendering approach

Do **not** reach for Three.js here, even though it is already a dependency
(`ui/package.json` carries three 0.185 for the globe). The app runs in its own
sandboxed document and would have to carry its own copy of the library, and a
vector game does not want a scene graph, materials or lighting. Battlezone-style
rendering is a 2D canvas, a list of line segments in 3D, a perspective divide, and
near-plane clipping. That is a few hundred lines with no dependencies, it renders
in a single self-contained HTML file, and it will hit frame rate on any machine
that can run the wallet. It also keeps the added binary size in the tens of
kilobytes rather than the hundreds.

---

## 4. What the game itself involves

Ranked roughly by effort, all of it ordinary work with no research risk:

**The engine (the real work, but well-understood)**
* A 3D point/vector type, a camera with position and heading, a perspective
  projection to screen space.
* Line clipping against the near plane. This is the one bit that bites if skipped:
  without it, lines that cross behind the camera draw as garbage streaks across
  the screen. Well-documented, small.
* A canvas line renderer with the phosphor look: green stroke, slight glow,
  optional bloom via a second blurred pass or a shadow blur.

**The world**
* Flat ground with a horizon line and a scrolling mountain silhouette that never
  gets closer. This alone sells the whole illusion.
* Static obstacles: cubes and pyramids scattered on the plain, which block shots
  and give the player cover.
* A volcano and a crescent moon on the horizon for flavour.

**Gameplay**
* Twin-tread movement: two controls, left tread and right tread, both forward
  turns, opposite spins in place. This is what makes it feel like the original and
  not a generic FPS. Map to Q/A and P/L, or to the arrow keys plus a simplified
  mode for people who bounce off dual-stick.
* Firing, projectile travel, collision against obstacles and enemies.
* Enemy roster: slow tank, fast "supertank", a missile that homes in a straight
  line, and a saucer that drifts across and is worth bonus points but does not
  shoot.
* Enemy AI: circle, approach, take cover behind obstacles, fire when lined up.
  Simple state machine, no pathfinding needed.
* The radar sweep in the top centre, showing enemy bearing.
* Score, lives, extra life at a threshold, wave escalation.
* The cracked-screen overlay when you are hit. Cheap, memorable, and a strong
  moment.

**Presentation**
* Attract mode with the title and a demo, so the panel is not a blank screen.
* Sound: the wallet already has `ui/src/sound.ts`, but the game is in its own
  sandboxed document, so it needs its own audio. Web Audio oscillators generate
  the engine drone, the firing thump and the explosion noise with no audio files
  at all, which keeps the bundle tiny and avoids `media-src` questions entirely.
* Gamepad support via the browser Gamepad API is nearly free and suits the game.

**Deliberately out of scope for a first version:** online leaderboards (there is no
store backend and the sandbox has no network), points or DIVI integration, and
multiplayer.

---

## 5. Risks and honest unknowns

* **Feel is the risk, not the code.** Getting the tank to feel heavy and the
  enemies to feel menacing rather than random is iteration, and iteration on DD69
  is slow because every test needs a version bump, a UI build, a cargo build, a
  copy into /Applications/DD69.app and a relaunch. Mitigation: develop the game as
  a standalone HTML file opened in a normal browser, where the loop is instant,
  and only fold it into the binary once it plays well. The sandbox restrictions
  are strict enough that a file that works in a plain browser with no network and
  no dependencies will work in the app.
* **Binary size.** Target under 100KB of game. That is realistic for a
  dependency-free canvas game with generated audio. Worth measuring rather than
  assuming.
* **Immersive mode is written but, as far as I can tell, has never carried a
  demanding app.** Keyboard focus, resize behaviour and the escape affordance
  under a canvas that captures keys are the likely rough edges. Small fixes, but
  expect a few.
* **Frame pacing inside a WKWebView on macOS while a node is syncing** is not
  something I have measured here. A line renderer is light, so I expect it to be
  fine, but it is an expectation, not a measurement.
* **Distraction question, not a technical one:** does a game belong in a wallet at
  all? The argument for is that Community Apps is a platform play and needs a
  showcase, and a game is the most shareable possible showcase. The argument
  against is that a serious financial tool is judged on focus. Ultimately a call
  for Geoff. Shipping it as a Community App rather than a top-level nav item is
  the compromise: it lives on the shelf, not in the wallet's face.

---

## 6. Recommended plan

1. Agree the name and confirm Battlezone style over Star Wars style.
2. Build the game standalone as one HTML file, iterating in a browser. Get the
   line renderer, the horizon and the tank feel right before anything else.
3. Add the enemy roster, radar, scoring and waves.
4. Add attract mode, generated audio, gamepad support, and the high score table on
   top of the app storage API.
5. Fold it in: new folder under `crates/app/src/community/`, a `manifest.json`
   with an empty permission list and `"immersive": "on-demand"`, a `thumb.svg`,
   and one entry in the `BUILTINS` table in `crates/app/src/community.rs`.
6. Version bump, build, install to /Applications/DD69.app, relaunch, test.

Confidence that this ships and works: high on the plumbing (the sandbox, built-in
app path and immersive mode are all real, in-tree and tested, and I read them
rather than assumed them). Medium-high on the game itself: the technique is
well-trodden, but "does it feel good" is only answerable by playing it.

Confidence that we cannot simply lift an existing open source version: high. I
checked licenses on every candidate directly.
