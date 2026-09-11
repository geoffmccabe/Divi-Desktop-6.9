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

## Second pass (2026-Sep-10, evening)

**Sound, still silent.** The bus meter now read a level (0.006 RMS) and the
watchdog had kicked the context once, and Geoff still heard nothing. So the
signal reaches the end of the graph; the silence is between WebKit's output
and the speakers. Two changes:

1. The watchdog no longer acts from a timer. WebKit ties a context's right
   to make sound to a user gesture, and a suspend/resume or a new context
   made from a timer can leave one that says "running" and is not allowed to
   play: the fault, caused by the cure. The verdict is held and carried out
   inside the next real key or pointer press (`settleAudioFromGesture`),
   which the game already routes every gesture through.
2. The black box shows the pending verdict.

What I checked on the Mac itself: default output is the built-in speakers,
not muted; CoreAudio shows an active output context; the node of the
WebKit GPU process is running. What I could not do is hear it. If it is
still silent with a level on the meter, the next step is outside this app:
quit and reopen the wallet from the Dock (not from a script), then open the
game and press a key before judging.

**The beam looked flat.** A single-colour open cone with no lighting is a
flat wedge from any angle. It now fades along its length (bright at the
muzzle, gone at the far end, which under additive blending is a fade to
transparent) with a brighter, narrower core inside, so it reads as a volume,
and the shop eases the view round to three-quarters while a beam is held so
the cone is seen going away rather than end-on.

**The store.** Price in green only when it can be bought; red when the
player is short; "OWNED" in green instead of a price once bought.

## The 5,000 DIVI send that timed out, and node switching

The send never left the wallet (checked the node's own transaction list),
so nothing was lost. The read timeout was 30 seconds and the node was busy.
Why busy: the interface has two dozen panels polling the node on their own
clocks; a node switch (below) makes them all ask at once, the node has
sixteen RPC threads, and a send queued behind them lost its answer.

Three changes in the Rust side (`crates/supervisor/src/rpc.rs`, `wallet.rs`):

- At most 6 RPC calls in flight from the app at once; the rest wait in
  order. The node always has threads left.
- Sends and unlocks use a 180-second read timeout. A big wallet takes time.
- A send whose answer was lost is looked for on the node (same address,
  same amount, since the call began) for up to a minute before it is called
  a failure, so a lost answer is never mistaken for a failed send, and a
  second attempt never doubles it.

**Switching nodes** (`ui/src/Shell.tsx`, `activeNode.ts`): the whole shell
body is remounted on a switch (a React key), so every panel starts in its
own loading state and asks the new node at once; nothing from the old node
stays on screen. The transaction cache is keyed by node id so the old
node's history does not reappear from local storage. Other per-node caches
(node identity, staking preference, PoE history) are still global and are
the next candidates if something else looks stale.
