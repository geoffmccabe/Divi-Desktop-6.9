# Divi Rebels: the sound bus, and where the guns are

2026-Sep-10, after Geoff's fifth "no sound" and the shop's beam drawn as a
flat triangle on top of the hull.

## Sound: one bus, and a watchdog that can hear

Every sound in the wallet now connects to `output()` in
`/Users/geoffreymccabe/dd69-rebels/ui/src/sound.ts`: one master gain, into
one analyser, into the speakers. The wallet's click sounds, the game's guns,
warnings, boost, beam and the music all go through it. Nothing connects to
the speakers directly any more, because a node wired straight to them is a
node nobody can measure.

Why: four of the five silences were reported by code that said it was
playing. The black box showed a running context, decoded buffers, a music
voice, a volume, and Geoff heard nothing. Everything that could be checked
on the code's side was fine; the fault was between the graph and the
speakers, where nothing was looking. The analyser looks there: it measures
what actually reaches the output.

`watchAudio()` is called every two seconds by the game while music is
meant to be playing (and the player is not mid-death-fade). Silence at the
output for 4 seconds: the context is kicked (suspend, resume: the standard
cure for a WebKit context that reports "running" and outputs nothing). 12
seconds: the context is thrown away and rebuilt, and every module that
registered with `onAudioRebuild` decodes its samples again and restarts
what it was playing. Both are rate limited (8 and 30 seconds) so a genuine
silence cannot loop it.

The black box (`dd69.rebels.diag`, read with `scripts/read-rebels-diag.sh`)
now has a `bus` entry: context state, output level, seconds silent, kicks,
rebuilds, sample rate, and the last verdict. If Geoff says "no sound" again,
read that FIRST. A level above zero with nothing heard is the machine's
output device, not the code.

Honest note: I could not reproduce the silence here, so the watchdog is a
defence against the class of fault, verified only by unit tests with a fake
context (`rebelsAudio.test.ts`, "the one bus").

## Guns: mounts read off the hull

The pack's models are one mesh each with no named parts (every .glb
checked: one node, one mesh), so mounts are read off the geometry
(`fitMounts` in `shipCollider.ts`), in the same centred unit frame the hit
spheres use, +Z forward:

| Mount | Rule | Used by |
|---|---|---|
| nose | forward-most vertices, averaged | beam, mini gun (third person) |
| gunL, gunR | forward-most vertex of each wing's outer 45% | the pulse gun's two barrels |
| belly | lowest vertex under the middle third, on the centreline | torpedoes |

A hull whose span is under a third of its length is treated as wingless and
gets barrels a twelfth of a length either side of the nose. An offline scan
of all 32 hulls (node transforms applied) put the barrels where they should
be on every fighter, bomber and stealth; the tall carriers and stations are
odd shapes and get odd but harmless answers.

In the cockpit the barrels still fire from the corners of the frame, as
Geoff asked earlier; the mounts apply the moment the camera leaves the ship
(third person) and in the shop.

## The beam was drawn backwards

`beamGeometry()` opens along +Z (its bounding box after the rotation is z 0
to 1). The drawing code turned it to face MINUS the firing direction, so
every beam was drawn pointing out of the back of the ship while its damage
went forward. Invisible from the cockpit (it is behind the camera); in the
shop it was a cone over the hull pointing the wrong way. Fixed in
`rebelsFx.ts`; the shop's preview uses the same geometry and orientation.

## The shop's test fire

The picture is drawn inside the ship preview now (`ShipPreview.tsx`, `fire`
prop): the same cone at the weapon's real angle (2 to 5 degrees; it was a
40-degree CSS triangle before), leaving the nose; rounds leaving the wing
tips or the nose. `TestFire.tsx` keeps only the sound and the five-second
limit. Verified in a browser: the beam leaves Fighter V's nose as a thin
cone pointing forward.

## Scrolling the store

The Network Map wrapper took every wheel event inside it for map zoom and
cancelled it, and the store sits inside that wrapper. Wheel events over the
game's own panels are now left alone. Verified in a browser: the weapon list
scrolled 353 pixels on a five-tick wheel.
