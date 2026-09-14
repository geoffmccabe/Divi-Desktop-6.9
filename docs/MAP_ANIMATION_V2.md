# Map animation v2

**The rule:** every act of communication the app performs is drawn on the map,
and nothing is drawn that isn't really happening.

Status: flat map done, off by default. **Cmd-Shift-N** toggles it live.
(Cmd-N was already taken by the new-install simulator.)

## The two grammars

**Arc** — a message travelling from our node to somewhere.
**Rings** — one second of concentric circles at a location. The colour is what
we now know about that place.

## The colour ladder

A node walks this ladder as we learn about it. It never turns gold unless the
machine actually answered.

| Colour | Meaning |
|---|---|
| Green arc | We are reaching out to this node |
| Grey rings | The request landed, no answer yet |
| Red rings | Refused, timed out, or answered negatively |
| Gold rings | Alive and answering |
| Fuchsia rings | Now a real peer of our node |
| Cyan | Traffic that leaves the Divi network entirely |

## Files

| File | Role |
|---|---|
| `ui/src/wallet/mapEvents.ts` | The trigger catalog and the event bus. Producers emit, consumers read. |
| `ui/src/wallet/mapAnimRender.ts` | One renderer, shared by every surface. |
| `ui/src/wallet/mapExternal.ts` | Non-Divi calls (price, geolocation, updates). |
| `ui/src/wallet/mapAnimFlag.ts` | The on/off switch. |

## Adding a trigger

Add a row to `CATALOG` in `mapEvents.ts` and call `emitMap()` where the thing
actually happens. Every surface picks it up with no further work. A feature
must never draw on the map directly.

## Honesty rules

These are the point of the system, not decoration.

1. **Emit only on real events.** Never on a timer standing in for one.
2. **Fire on the transition,** not on every poll, or a standing peer re-pulses
   forever.
3. **Counters derive from the same events as the animations.** The Nodes count
   reads off the event stream, so a number cannot move without an animation
   having fired. It counts nodes that actually answered this session, which is
   smaller and slower than the old 90-day cached count. That is the correction,
   not a bug.
4. **Never invent a location.** Services whose real location we do not know get
   one shared symbolic offshore anchor whose label says the location is not
   known. A plausible-looking city would be a quiet lie.
5. **Presentation may stagger, never fabricate.** A probe wave really does go
   out at once; spreading the arcs over a few seconds makes it readable. The
   staggering changes when an event draws, never whether it happened.

## Surfaces

The renderer needs only a lat/lon to screen-point function and where our own
node is, so every surface shares it.

- **Flat map** (`NetworkMap.tsx`) — done. Uses the map's zoom/pan-aware `P()`.
- **Globe** (`GlobeMap.tsx`) — next. It is WebGL, so the plan is a transparent
  2D canvas over it using `globeRef.current.getScreenCoords(lat, lng)`
  (confirmed present in react-globe.gl 2.38.0), returning null for points over
  the horizon so the far side of the world doesn't draw through.
- **In-game** (`rebels/orbitWorld.ts`) — after the globe, same approach.

## Still to do

- Globe and in-game surfaces.
- Block-advance and transaction-broadcast triggers are in the catalog but not
  yet emitted anywhere.
- Rust-side events (`price.rs`, `updates.rs`, `rpc.rs`) so the supervisor's own
  traffic is represented, not just what the interface initiates.
- Phase 7: once approved, make v2 the only system and delete the old polling
  colour logic and the cached Nodes count.
