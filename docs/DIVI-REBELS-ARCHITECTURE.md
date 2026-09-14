# Divi Rebels: Architecture

Written 2026-Sep-14 from the code as it stands at app v69.9.47. Which version loads which file was read from the bundler's own list of inputs, not by hand.

## The shape

- **One game core**, shared by the desktop app and divi.love/rebels.
- **Two thin doors**: the app door and the web door. Each answers the game's questions (who is playing, where progress is kept, the DIVI price, what the wallet can do) in its own way.
- **One game server** that both versions connect to, so app and web players share the same sky.
- **A boundary guard** (scripts/check-rebels-boundary.mjs) fails the build if the shared core ever reaches into the wallet or the desktop bridge.

## By the numbers

| Part | Files | Lines |
|---|---|---|
| Shared by app and web | 73 | 26,252 |
| ...of which also run on the game server | 10 | 5,252 |
| App only | 12 | 3,620 |
| Web only | 12 | 704 |
| Game server | 7 | 2,713 |

The app-only count is mostly the existing wallet (the Node Map screen alone is 1,881 lines). The app's door itself is two files, 81 lines. The web door and page together are 704 lines.

Not counted: 16 sound, image and map files (shared), the Rust desktop shell (app only), 7 database migrations, and 31 test suites plus the boundary guard.

## The doors

How the one game plugs into each place it runs. The game only ever asks its door.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `platform.ts` | Shared | 170 | The contract: the list of questions every door answers (who is playing, storage, price, wallet, detail, input). |
| `current.ts` | Shared | 48 | Which door the game is behind right now, plus a neutral stand-in used by tests. |
| `defaults.ts` | Shared | 29 | Starting values every door shares: the game server address, globe detail, plain browser storage. |
| `desktopInput.ts` | Shared | 41 | Keyboard and mouse wiring. A phone version will plug touch in here instead. |
| `coreEntry.ts` | Shared | 11 | What a door mounts. The boundary guard packages this to prove the game has no wallet inside it. |

## Game rules and simulation

The fight itself. These files run in the player's game AND on the game server, so both sides agree.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `rebelsCombat.ts` | Shared + server | 2,370 | Bullets, enemy fighters, hits, waves, loot and the dragon. |
| `rebelsFlock.ts` | Shared + server | 991 | Alien sphere swarms that fly as one and break apart. |
| `rebelsWings.ts` | Shared + server | 120 | Wingman drones flying formation. |
| `orbitFlight.ts` | Shared + server | 814 | Flying, boosting, docking at towers, ammo and shields. |
| `orbitWorld.ts` | Shared + server | 214 | World size and the constants that tie ship, globe and towers together. |
| `weaponCatalog.ts` | Shared + server | 232 | Every weapon: damage, reach, price, what must be owned first. |
| `itemCatalog.ts` | Shared + server | 286 | Every item: store gear, dropped items, forged tiers, what each does. |
| `dropCharts.ts` | Shared + server | 167 | What a wreck leaves behind, and how often. |
| `dropConfigRemote.ts` | Shared + server | 47 | Reads the live drop charts you can edit, for game and server alike. |
| `rebelsView.ts` | Server only | 94 | How far away each player is told about things (used by the server only). |

## The cockpit engine

Runs the game frame by frame and draws it into the globe.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `rebelsController.ts` | Shared | 2,807 | The heart of the game: flight, firing, docking, death, launch, cheats, the room connection. |
| `rebelsFx.ts` | Shared | 1,372 | Everything drawn in the sky: enemies, bullets, explosions, beams, coins. |
| `rebelsPeers.ts` | Shared | 223 | Other players' ships, in their own paint with their names over them. |
| `rearGun.ts` | Shared | 67 | The rear-view window and aiming backwards. |
| `shipLean.ts` | Shared | 109 | Makes the hull bank and lean so it looks like it is flying. |
| `shipCollider.ts` | Shared | 353 | A hit shape that follows the hull instead of a ball. |
| `healthPulse.ts` | Shared | 24 | Tiny signal for the health bar that flashes when you are hit. |

## Multiplayer connection

The player's end of the shared game server.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `rebelsRoom.ts` | Shared | 705 | Joins the room, overflow rooms, smoothing other ships, hidden-tab release. |
| `rebelsBank.ts` | Shared | 63 | What the ledger says you have banked, and asking to cash out. |

## Progress and the account

What you own and earn, kept on the device and on your account.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `rebelsArmoury.ts` | Shared | 406 | Points earned and spent, weapons and gear bought, what the ship carries. |
| `rebelsInventory.ts` | Shared | 162 | Found items and sealed spheres, stacked by kind. |
| `shipFleet.ts` | Shared | 128 | Each ship's name and the upgrades fitted to it (Apply to Ship). |
| `rebelsScores.ts` | Shared | 250 | High score tables and the player's DIVI tally. |
| `rebelsLoadout.ts` | Shared | 91 | Saves purchases and items to the account and reads them back. |
| `rebelsShips.ts` | Shared | 122 | Saves ships (name, paint, upgrades) to the account and reads the fleet. |
| `rebelsForge.ts` | Shared | 47 | Forging four items into one, decided by the server. |
| `supabaseProject.ts` | Shared + server | 11 | The Divi Desktop database address and public key. |

## Ships

The 32 hulls, how they look and what they carry.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `shipCatalog.ts` | Shared | 207 | The 32 ships and their stats. |
| `shipChoice.ts` | Shared | 41 | Which hull you fly (guests: always the first). |
| `shipColours.ts` | Shared | 501 | Painting ships, and the shader that does it. |
| `shipLoadout.ts` | Shared | 98 | Which weapon is selected in each slot. |
| `spaceAssets.ts` | Shared | 328 | Loads the 3D ship and planet models from the asset server. |

## Space, sky and effects

The world around Earth.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `spaceEnvironment.ts` | Shared | 338 | The fourteen planets and the space around Earth. |
| `starfield.ts` | Shared | 224 | The star sky behind everything. |
| `starCatalog.ts` | Shared | 112 | Unpacks the star data. |
| `starCatalogData.ts` | Shared | 771 | The packed night sky. |
| `rebelsMandala.ts` | Shared | 345 | The shield, seen from the cockpit as a mandala. |
| `rebelsMandalaSkin.ts` | Shared | 279 | The mandala skin on dropped spheres. |
| `sphereCards.ts` | Shared | 143 | The little turning spheres on inventory cards. |

## The globe

The Divi node map the game flies over. Built for the wallet, used by both versions.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `GlobeMap.tsx` | Shared | 1,295 | The 3D Earth, node towers and network links; hands the game its scene. |
| `towerLights.ts` | Shared | 195 | Lit windows and beacons on the towers. |
| `globeDetail.ts` | Shared | 261 | Sharper ground under the camera. |
| `earthTiles.ts` | Shared | 181 | The high-detail night map, loaded in pieces. |
| `globeBorders.ts` | Shared | 100 | Country outlines. |
| `activityPulse.ts` | Shared | 179 | The network activity ripple along the links. |

## Screens and panels

Everything you click and read.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `RebelsHud.tsx` | Shared | 445 | The cockpit screen: gauges, launch card, YOU HAVE DIED, wave banner. |
| `ShipMarket.tsx` | Shared | 366 | The Ship Market: hulls, stats, paint, ship name, tabs. |
| `ShipPreview.tsx` | Shared | 374 | The turning ship in the market. |
| `TestFire.tsx` | Shared | 83 | Try a weapon in the shop. |
| `WeaponStore.tsx` | Shared | 175 | The weapons tab. |
| `ItemStore.tsx` | Shared | 132 | The items (gear) tab. |
| `PointsPanel.tsx` | Shared | 394 | Points and DIVI: buy points, convert, cash out. |
| `InventoryPanel.tsx` | Shared | 246 | The inventory (I): ships, gear, spheres, items, Apply to Ship. |
| `RebelsScoreboard.tsx` | Shared | 65 | High score tables. |
| `RebelsControls.tsx` | Shared | 271 | The controls table and the keyboard help card. |
| `RebelsHealthBar.tsx` | Shared | 69 | The health bar. |
| `ShipBadge.tsx` | Shared | 40 | Your ship in the corner of the cockpit. |
| `DflowPanel.tsx` | Shared | 82 | The DFlow performance panel (#). |
| `orbit.css` | Shared | 1,087 | The game's styles. |

## Sound, look and diagnostics

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `sound.ts` | Shared | 370 | The one sound bus everything plays through. |
| `rebelsAudio.ts` | Shared | 579 | Gun, torpedo, explosion and station sounds. |
| `rebelsMusic.ts` | Shared | 351 | Menu and flying music, and the fade between. |
| `rebelsDflow.ts` | Shared | 345 | DFlow: records where every frame's time goes. |
| `tokens.ts` | Shared | 207 | The Rebels colours and every themable value. |
| `ThemeProvider.tsx` | Shared | 79 | Applies the colours to the page. |
| `store.ts` | Shared | 64 | Writes theme values as page styles. |
| `skins.ts` | Shared | 17 | The built-in skin. |
| `icons.ts` | Shared | 108 | Icons as style values. |
| `index.css` | Shared | 2,225 | Shared page styles, fonts, cockpit and banner styles. |

## App only

What only the desktop app has. The door is tiny; the rest is the wallet the door reaches into.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `index.ts` | App only | 33 | The app's door: answers every question from the wallet. |
| `identity.ts` | App only | 48 | Who you are in the app: your node's chosen name. |
| `NetworkMap.tsx` | App only | 1,881 | The wallet's Node Map screen, which hosts the game in the app. |
| `value.ts` | App only | 213 | The wallet's DIVI price feed. |
| `api.ts` | App only | 668 | Wallet calls: check an address, your addresses, send DIVI. |
| `tauri.ts` | App only | 47 | The bridge to the desktop app's Rust side. |
| `bridge.ts` | App only | 56 | More desktop bridge calls used by the Node Map. |
| `PurchaseWithDivi.tsx` | App only | 338 | Buy points by sending DIVI from your wallet. |
| `stakeWin.ts` | App only | 54 | Tells the game your node just won a stake (triple damage). |
| `knownPeers.ts` | App only | 146 | Nodes your wallet has seen, for the Node Map's towers. |
| `vite.config.ts` | App only | 26 | Builds the app as one file inside the desktop app. |
| `install-local.sh` | App only | 110 | Builds, installs and relaunches DD69 on this Mac. |

## Web only

What only divi.love/rebels has.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `webDoor.ts` | Web only | 50 | The web's door: guest identity, IndexedDB storage, price, cash-out rules, guest limits. |
| `pilot.ts` | Web only | 80 | A guest's pilot name and private id, kept in the browser. |
| `webStore.ts` | Web only | 155 | IndexedDB storage that keeps guests' progress between visits. |
| `webNodes.ts` | Web only | 65 | Towers from the Scanner's node list, with London as home. |
| `webPrice.ts` | Web only | 34 | The DIVI price, read from the same table the app uses. |
| `diviAddress.ts` | Web only | 43 | Checks a DIVI address without a node. |
| `main.tsx` | Web only | 91 | The page: loads the guest, storage and towers, then the game. |
| `web.css` | Web only | 14 | Full-window page and the loading screen. |
| `index.html` | Web only | 13 | The page shell. |
| `vite.web.config.ts` | Web only | 30 | Builds the web version as separate cacheable files under /rebels/. |
| `worker.ts` | Web only | 104 | Cloudflare Worker at divi.love/rebels: serves the game and the node list. |
| `wrangler.jsonc` | Web only | 25 | The Worker's settings and the divi.love/rebels route. |

## Game server (used by both)

One server for everyone. App and web players connect to the same rooms.

| Module | Where it runs | Lines | What it does |
|---|---|---|---|
| `room.ts` | Server (both) | 1,568 | A shared world: runs the fight, seats players, guests, overflow, cash-out requests. |
| `ledger.ts` | Server (both) | 398 | Banked DIVI, kills and items per account; cash-out bookkeeping. |
| `protocol.ts` | Server (both) | 327 | The messages between game and server; room names and guest ids. |
| `worker.ts` | Server (both) | 58 | The front door: routes to rooms and the ledger. |
| `wrangler.jsonc` | Server (both) | 23 | The server's settings. |
| `divi-rebels-payout.py` | Server (both) | 245 | The London payout service that sends cashed-out DIVI. |

## Files

Folders, for finding things (all under /Users/geoffreymccabe/dd69-rebels):

- shared game: ui/src/wallet/rebels/
- doors: ui/src/wallet/rebels/platform/ (app door in platform/app/)
- web door and page: ui/src/web-rebels/ and ui/web-rebels/
- globe: ui/src/wallet/
- game server: contrib/rebels-room/
- web host: contrib/rebels-web/
- database changes: supabase/migrations/ and contrib/rebels-room/supabase/
