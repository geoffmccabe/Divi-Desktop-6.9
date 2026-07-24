# Newest Nodes — spirals + panel — build scope

Spotting brand-new nodes joining the Divi network: an animated spiral on the map
at each new node, plus a "Newest Nodes" panel in the bottom-right.

⚠ **Ownership / collision.** This lives in `NetworkMap.tsx` + `knownPeers.ts`,
which the **map agent** is actively editing (many commits over the past week).
This is a scope, not a green light to build — agree who builds it first, and keep
the new pieces in **separate files** where possible (a `newNodes.ts` for the data
+ lifecycle, a `NewestNodesPanel.tsx` for the panel) so the only edits to the
shared canvas file are the spiral draw call and one state hook.

Decisions locked with Geoff (2026-Jul-24):

| Question | Decision |
|---|---|
| What is "new"? | **Never-seen IP only.** Today's 93 are baseline/existing; only genuinely first-seen IPs after today spiral. |
| Panel lists | **Only nodes still spiraling** (within their 10-day window), newest on top. May be short or empty on a quiet week. |
| Overlapping spirals (VPN/datacenter) | **Fan out** stacked spirals a few px apart so each is visible + clickable. |
| Arrival cue | **One-time flash + soft chime** the first time a node is detected. |

---

## 1. The data model

`KnownPeer` currently has only `lastSeen`. Add **`firstSeen: number`** (unix ms).
That single field drives the entire feature — a node's age = `now - firstSeen`.

**Baseline migration (runs once, on first launch of the build that ships this):**

- For every existing known node, stamp `firstSeen = now - 11 days` (older than the
  10-day window ⇒ not new, no spiral). This freezes today's 93 as "existing".
- **Seed the test node:** set `firstSeen = <today, day 0>` for the Costa Rica
  desktop node — IP `201.206.191.234` (Heredia, CR, 9.9985 / -84.1171). It is the
  user's own node, so the feature must also spiral a node in the self/`myNodeIps`
  set, not only P2P peers. This gives one guaranteed test spiral from day 0.
- Guard the migration with a version flag in localStorage
  (`dd69.newNodes.baselined`) so it never re-stamps and never re-freezes a
  genuinely new node.

**Going forward:** `recordKnown` sets `firstSeen = now` the first time it writes an
IP, and never overwrites it after. (Note: `recordKnown` was recently hardened to
merge onto the on-disk store so it can only ADD nodes — `firstSeen` must be set
inside that same merge, reading the stored value first so a re-seen node keeps
its original date.)

---

## 2. The spiral

An **Archimedean spiral**, 1px stroke, drawn on canvas in the map's animation
loop — the same rAF that draws everything else, so it costs nothing extra.

**Geometry.** `r(θ) = a·θ`, θ from 0 to N turns (≈3 turns reads well), scaled so
the outer radius = the current diameter/2. Draw as a polyline of ~60 points.

**Size over 10 days (linear shrink, then gone):**

```
day 0  → 25px   (100%)
day 1  → 22.5px (90%)
day 2  → 20px   (80%)
 …          (−10% per day)
day 9  → 2.5px  (10%)
day 10 → removed — node becomes a normal dot, drops out of the panel
```

`diameter = 25 * max(0, (10 - ageDays) / 10)`. Age in **whole days** so it steps
once per day, not continuously (matches "the first day it's largest").

**Spin.** 3 revolutions/minute = one turn per 20s. Rotation offset =
`(now / 20000) * 2π`, applied to θ. Continuous, smooth, shared clock.

**Colour — aqua, hue-pulsing every second.** Aqua sits halfway between the map's
green (`hsl(145 …)`) and blue (`hsl(210 …)`) ≈ **hue 177**. Pulse the hue ±~20°
around that once per second: `hue = 177 + 18·sin(now/1000 · 2π)`, sweeping
green-blue ↔ blue-green. Full saturation, ~60% lightness.

**Z-order (critical, per Geoff).** New-node spirals draw in a **top pass, after
every node circle and mesh line**, because VPN/datacenter clustering means they
often land on busy locations and must never be hidden by a peer circle. The
one-line rule: spirals are the last thing painted each frame (below only the
tooltip and the self "YOU" marker).

**Overlap fan-out.** Group new spirals by rounded lat/lon. Within a group of n,
offset each by a small radial nudge (≈ (index)·6px on a ring) so they form a
readable little cluster instead of one blob. Keep the offset stable per IP
(derive the angle from `phaseOf(ip)`) so they don't jitter frame to frame.

**Highlight state** (hovered/clicked in the panel): that spiral grows to **2×**
diameter, spins **3× faster** (one turn per ~6.7s), and pulses its hue faster.
One `highlightIp` piece of state, read in the draw loop.

---

## 3. Arrival cue (one-time, per node)

The first time an IP is recorded, fire once:

- a brief expanding ring + flash at its map point (~800ms, aqua), and
- a soft chime via the existing `playSound` path (a new gentle sound key).

Track which IPs have already been announced in `dd69.newNodes.announced` so a
relaunch doesn't replay them. Only genuinely-new (never-seen) IPs qualify — the
baseline 93 never fire.

---

## 4. The "Newest Nodes" panel (bottom-right)

New component `NewestNodesPanel.tsx`, mirroring the existing map panels (Fastest
Nodes top-right is the closest sibling — reuse its open/close + styling).

- **Trigger:** a small icon button in the **bottom-right** of the map (a sparkle
  / "new" glyph). Opens a frosted panel like the others.
- **Contents:** nodes still within the 10-day window, **newest on top**, each row
  showing location (`City, Country`), the age ("today", "2 days ago"), and a tiny
  spiral swatch in its current colour. Cap at 10 (top-10 newest).
- **Empty state:** "No new nodes in the last 10 days." (Honest — quiet weeks look
  quiet.)
- **Hover or click a row →** set `highlightIp` for that node → its map spiral goes
  2× + 3× spin (see §2). Clicking could also recentre/pan the map to it.

The panel reads the same new-node list the map draws from, so the two never
disagree.

---

## 5. Honesty notes (keep in the code + any UI copy)

- A spiral means "first seen by **your** node(s) on this date" — not "joined the
  network on this date". A node could be old but new *to us*. The panel/tooltip
  wording should say "first seen", not "joined".
- One physical machine behind a VPN can appear as several IPs; several machines
  behind one VPN exit share a location. Spirals count IPs, not machines. Fan-out
  helps but can't disambiguate — don't claim precision the data lacks.

---

## 6. Build order

1. `newNodes.ts` — `firstSeen` field, baseline migration (freeze 93 + seed CR),
   age helpers, the new-node list selector, announce-tracking. **No UI.**
2. Wire `firstSeen` into `recordKnown` (one careful edit, inside the merge).
3. Spiral draw pass in `NetworkMap.tsx` (size/spin/hue/z-order/fan-out) — the one
   real edit to the shared canvas file.
4. `NewestNodesPanel.tsx` + its bottom-right trigger.
5. Arrival flash + chime.
6. Verify: CR node spirals at 25px day 0; fast-forward a stored `firstSeen` to
   test the shrink steps and the day-10 drop-off.

---

## 7. Open question for Geoff

- **Day-0 sizing is by whole days from `firstSeen`.** Across a timezone boundary,
  "day 0" ends at local midnight vs 24h-from-first-seen. Fine to use *calendar*
  days in the user's local time (so "today" = day 0 until local midnight)? That's
  the intuitive reading and the default unless you'd prefer rolling 24h buckets.
