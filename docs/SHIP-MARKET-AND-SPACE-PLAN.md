# Divi Rebels: the Ship Market and the space around Earth

What Geoff asked for, what I found when I went looking, and the order it gets
built in.

## What is actually there

The Synty **Sci-Fi Space** pack is already converted and living on R2 at
`https://assets.dreadroot.com/siege/scifi/`, one `.glb` per model, indexed by
`_catalog_space.json` (631 items). DreadRoot reaches it through
`src/config/assetBase.ts`. Nothing needs converting or uploading.

* **32 ships**, which is more classes and more variants than the message listed:
  Fighter 01-05, Fighter Heavy 01-04, Bomber 01-04, Stealth 01-05, Cruiser
  01-03, Transport 01, Massive Transport 01, Galactic Carrier 01 + Armor 01,
  Colossal 01, Station 01-06.
* **14 planets**, `space_SM_Env_Planet_01` through `_14`, exactly as described.
* **7 asteroids**, 15 debris pieces, 3 warp-gate parts, a beacon, turrets.

## Three things that have to be solved first

### 1. Every space model has the wrong texture

This is the "broken textures" Geoff saw, and it is not a per-model problem. I
pulled eight models off R2 and read their glTF headers: a fighter, a cruiser, a
station, three planets, an asteroid and a warp gate. **Every one of them points
at the same image**, `PolygonSciFiSpace_Signs_Texture_01_A.webp`, which is the
atlas of signage. The conversion stamped one texture onto the whole pack.

The geometry is fine and so are the UVs, because Synty models are all laid out
against one shared atlas. Only the image is wrong. So the repair is to swap the
base colour map at load time:

* everything except planets gets `PolygonSciFiSpace_Texture_01_A.webp`, which
  IS on R2;
* planets get `Planet_Texure_02.webp`, which is **not** on R2 — it only exists
  in DreadRoot's local demo folder. It is 22KB, so it gets bundled rather than
  uploaded.

Both atlases are bundled (192KB together, against a 6.4MB app) so a texture
never costs a request and the fix cannot be undone by an R2 change.

### 2. The wallet's content policy blocks the asset host

`crates/app/tauri.conf.json` lists every host the app may talk to, and
`assets.dreadroot.com` is not among them. Until it is, every model fetch fails
silently. One narrow addition to `connect-src`: the exact host, no wildcard.

### 3. The planets are outside the world

Geoff's spacing, worked through: Earth is R=100, so an Earth diameter is 200
units. Planet N is (10 + 10N)% of Earth across and (4 + N) diameters out, so
planet 1 is 40 units across at 1,000 units, and planet 14 is 300 units across
at 3,600 units.

The flight ceiling is currently 800 units. **Planet 1 is beyond it**, so as
things stand not one of them could be flown to, and "approach within three
diameters and see its name" would never fire. The ceiling has to move out past
planet 14. At boost that is a 95-second flight to the far one, which is a long
way but is what the layout asks for.

The camera's far plane goes with it: 4,000 now, and it needs to reach ~12,000
or the outer planets simply are not drawn.

## Two things that are simpler than they look

**Geosynchronous orbit** costs nothing. The map's controls have `autoRotate =
false` and the towers live in a fixed group, so a fixed position in the scene
IS a geosynchronous one. Everything gets parented to the same group as the
towers, and if the globe is ever made to spin they all stay put over it.

**Not shipping the models in the download** is how DreadRoot already works and
how this will: the `.glb` files stream from R2. Persisting them so they are
fetched once is an IndexedDB blob store, which this codebase already uses for
node avatars, rather than the Cache API, which is less certain inside a
WKWebView.

## The phases

### Phase 1 — the pipeline. The one that everything else stands on.
* Add `assets.dreadroot.com` to `connect-src`.
* A loader: fetch a `.glb` once, keep the bytes in IndexedDB, serve every later
  request from there. Never fetch the same model twice on one machine.
* Repair the texture on the way through, per the rule above.
* Move the flight ceiling and the camera's far plane out past planet 14.
* **Proof it works: the 14 planets appear.** Sized and spaced to Geoff's
  numbers, each turning on its own axis, loaded when the game first opens
  because they are always in the sky.

### Phase 2 — the rest of the environment.
Asteroid belts, the six stations, the warp gate and debris fields, scattered
at fixed positions among the planets. Loaded with the planets, since they are
scenery too.

### Phase 3 — names and the approach readout.
Every planet, station and belt gets a name that sounds like it belongs in a
space game, plus its details. Come within three of its diameters and the name
and details appear in the top right, and go again when you leave.

### Phase 4 — the Ship Market.
A circular panel in the middle of the screen in the game's own style, one ship
turning slowly in front of it, its stats beside it, and a way through all 32.
Ship models load **only when shown**, which is what makes a 32-model shop cost
nothing until it is opened.

Stats, drawn from what space games actually track: hull, shield, speed,
agility, firepower, ammunition, cargo, crew, mass and signature. Within a
class, variant 01 is Tier 1 and each variant above it is 10% better across the
board, so Fighter 03 is 21% above Fighter 01.

### Phase 5 — flying what you bought.
Not asked for yet, and noted only so the Market is not built in a way that
makes it hard: the stats above are the same quantities the flight model and the
room already use, so a purchased ship becomes a set of numbers handed to
`createFlight` rather than a rewrite.

## Open question for Geoff

The stations are enormous: `SM_Ship_Station_01` is 565 units across, which is
nearly three Earth diameters at the game's scale. They are in the Market as
ships, but as scenery they would dwarf the planets. I have assumed they are
scaled down to about a fifth for the environment and shown at true size in the
Market, and will say so on screen rather than quietly shrink them.
