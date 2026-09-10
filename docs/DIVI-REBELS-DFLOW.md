# Divi Rebels DFlow

The game's own diagnostics panel. Press `#` in the cockpit to open it; COPY
REPORT puts the whole capture on the clipboard. Built 2026-Sep-10 after a
tier-1 swarm made the game stall.

## What it records, every frame

- **Frame time**: the browser's real interval between frames (16.7ms is
  60fps, 8.3ms is 120). This is what the player feels.
- **Our stages**, in milliseconds: `approach`, `flight`, `ship`, `room` (the
  socket step, report and the copy of the room's fight), `combat` (the solo
  simulation), `events` (sounds and sparks), `audio`, `meshes` (fighter hull
  models and shields), each drawing pass (`draw.bullets`, `draw.beams`,
  `draw.drones` which includes the living shapes and motes, `draw.orbs`,
  `draw.torps`, `draw.junk`, `draw.tracers`, `draw.coins`, `draw.gems`,
  `draw.dock`), `hud` (React updates), the map's own work (`map.sharpen`,
  `map.detail`, `map.lights`, `map.helix`) and `gl.render`, the renderer's
  submit, timed by wrapping the renderer's render call while the game is
  attached.
- **What was in the sky**: enemies, drones, flocks, bullets, tracers, beams,
  coins, gems, junk, torpedoes, peers, hull meshes.
- **Renderer**: draw calls, triangles, programs, geometries, textures, pixel
  ratio. A rise in programs is a shader compile and is noted, with the frame
  it landed in tagged.
- **Room**: messages and bytes per half second, the size of the last state
  message, status changes as notes.
- **Audio**: the bus meter's level.
- **Memory**: the JS heap where the webview exposes it (WebKit does not).

## How it is kept

Half-second summaries (average and max per stage) in a ring of five
minutes. Any frame over 40ms is kept whole: when, how long, the stage
breakdown, the counts, the draw calls, and a verdict: "in our code" when our
stages account for most of it, "outside our code (GC, layout, compositor or
GPU)" when they do not, "shader compile" when a program appeared that frame.
Notes: flocks arriving, drones gone, room status changes, compiles.

## Reading the report

1. FRAME TIME first: average, 95th, worst. If the average is fine and the
   worst is bad, it is stalls; look at WORST FRAMES.
2. WHERE OUR TIME GOES: the OUR TOTAL line against the frame. If ours is a
   small share, the cost is the GPU or the browser, and the draw-call and
   triangle numbers are where to look, plus `gl.render`.
3. WORST FRAMES: each one says what we were doing. A run of stalls tagged
   "shader compile" at the moment a flock appears is the shader being built
   for that tier's shapes: a one-off per tier per session.
4. RAW: one line per half second for a script or a spreadsheet.

Code: `ui/src/wallet/rebels/rebelsDflow.ts` (collector), `DflowPanel.tsx`
(panel), hooks in `rebelsController.ts`, `GlobeMap.tsx`, `rebelsRoom.ts`.
Tests: `scripts/run-rebels-dflow-tests.sh`.
