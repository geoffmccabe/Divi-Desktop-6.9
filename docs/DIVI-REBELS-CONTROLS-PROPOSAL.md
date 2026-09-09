# Divi Rebels: controls and weapons, measured against the genre

Geoff asked how far we are from what a space-shooter player expects, and what to
change. This is the answer, with the evidence, and it is a proposal rather than
a change: nothing here is built yet.

The research covered the shipped default bindings of Elite Dangerous, Star
Citizen, Star Wars Squadrons, Everspace 1 and 2, X4, Rebel Galaxy Outlaw,
Freelancer, X-Wing, TIE Fighter, FreeSpace 2 and Descent, mostly from the games'
own binding files and manuals rather than from wikis.

## The short answer

We are close on two things, missing two, and wrong on one that matters a lot.

| | Divi Rebels now | The genre | Verdict |
|---|---|---|---|
| Boost | SHIFT | SHIFT everywhere modern | correct |
| Fire primary | LEFT CLICK | LEFT CLICK, near-universal | correct |
| Fire secondary | none; RIGHT CLICK is the shield | RIGHT CLICK, near-universal | **wrong** |
| Roll | none at all | Q / E | **missing** |
| Throttle | none; speed is fixed | W / S | **missing** |
| Brake | Z | S, or X for a hard stop | unusual |
| Mouse flight | offset crosshair that springs back | relative look | **the one that matters** |

## The mouse, which is the important one

There are three ways to fly with a mouse, and the evidence on which is best is
unusually one-sided.

1. **Virtual joystick**: the crosshair's distance from the centre sets the turn
   rate, and it stays where you put it. Squadrons, Everspace 2, Star Citizen's
   default, Elite's default.
2. **Chase the reticle**: the ship flies an autopilot toward the cursor.
   Freelancer, X4, Wing Commander.
3. **Relative look**: mouse movement turns the ship directly, exactly like an
   FPS. Stop moving the mouse and the ship stops turning. Descent 3, FreeSpace
   2, Elite's optional Relative Mouse, Star Citizen's Relative mode.

Every game using the first ships a "recentre mouse" key, and every one of them
draws the same complaint. Squadrons has an EA bug report titled *"Mouse control
not fit for purpose"*. Elite's Relative Mouse option is off by default and
buried in the menus, and Frontier's own forums call it a *"secret easy mode"*
and *"the biggest skill booster in the game"*.

**We are on the first one**, and it is the direct cause of what Geoff has hit
three times: the crosshair drifting off centre and the ship turning on its own.
The spring-back I added is the same patch every one of those games ships, and it
is a patch on the wrong model.

**Recommendation: move to relative look.** Mouse movement turns the ship, and
when the mouse stops the ship stops. There is no crosshair offset to get stuck,
so the entire class of bug disappears rather than being damped. The crosshair
becomes the centre of the screen, which is also where the guns already converge.

The one thing we lose is aiming the mini gun away from the ship's nose. That is
worth losing.

## What is missing

**Roll.** We have pitch and yaw and no roll at all, which is why a free-flying
ship still feels stiff. Q / E is the modern default: Star Citizen, Everspace 1
and 2, X4 and Descent all use it. A / D gets roll only in games with no strafe —
Squadrons, No Man's Sky — and we would rather keep A / D for strafing later.

**A throttle.** Speed is currently fixed at cruise with a boost and a brake. The
genre splits cleanly: sims use a persistent throttle you set and leave, arcade
games use hold-W-to-thrust. We are arcade, so hold W to speed up and S to slow
down and reverse. Nobody expects anything else on those two keys.

That also frees **Z**, which is an odd place for a brake. In Elite, Z is flight
assist off.

## The proposed scheme

    MOUSE            Turn. Relative: move to turn, stop to stop.
    W / S            Thrust forward / slow and reverse
    Q / E            Roll left / right
    A / D            Strafe left / right          (new; needs a flight change)
    SHIFT            Boost
    X                Full stop
    LEFT CLICK       Primary weapon
    RIGHT CLICK      Secondary weapon
    1 2 3            Choose primary
    4 5 6            Choose secondary
    F                Shield                       (moved off RIGHT CLICK)
    V                Cockpit / third person       (as well as OPTION + WHEEL)
    T                Target nearest
    ESC              Back to the map

Four of those would feel actively wrong if we deviated, in the researcher's
words: left click primary, right click secondary, Q/E roll, and SHIFT boost. We
already have two right.

## Weapons: how to carry several and switch fast

The genre has settled on a shape, and it is worth copying exactly.

**Primary is energy and effectively unlimited. Secondary is ammunition and
limited.** Left button and right button. Star Citizen, Everspace, Squadrons,
FreeSpace 2 and Star Conflict all do this; Freelancer is the only odd one out
and only because left-drag was steering.

**Selection should be DIRECT, not cycled.** Descent bound 1-5 to primaries and
6-0 to secondaries in 1995 and nobody has criticised it since. Everspace 2 uses
1-4 and 5-8. Elite is the counter-example: its fire groups are the most
criticised weapon interface in the genre, its own forum has a thread titled
*"New player: Can't figure out weapons switching/firing logic"*, and the
standard player workaround is to pull time-critical items OUT of the cycle onto
their own keys — which is an admission that direct binding wins.

So: **1-3 primary, 4-6 secondary**, with the mouse wheel as an optional cycle
for convenience. Keep it to about five or six slots; more than that and nobody
can reach them mid-fight.

A shape that would fit what we already have:

| Slot | Kind | Notes |
|---|---|---|
| 1 | Pulse laser | what the ship has now |
| 2 | Mini gun | currently E + click, which is a modifier nobody else uses |
| 3 | Beam / heavy laser | found or bought |
| 4 | Torpedo | currently T or CTRL + click |
| 5 | Mine | drops behind, for a pursuer |
| 6 | Bomb | unguided, heavy, for stations |

The ships table already has room for this: `rebels_ships.paint` is jsonb and a
`loadout` column beside it would hold the six slots per hull without a migration
of anybody's fleet.

## One assist worth stealing

Rebel Galaxy Outlaw's mouse flight is *not* praised — its own developers
recommend a controller, and the Steam thread is titled "WTF Mouse control".
What reviewers did praise is **Autopursuit**: hold a button and the ship aligns
itself onto your target and matches its speed, putting you on their six while
you still aim and shoot yourself.

For a game where the fighters weave and a new player cannot get a shot off, that
is a much better answer than making the enemies dumber.

## What I would do first

In order, and each is useful on its own:

1. **Relative mouse look.** It is the fix for the bug Geoff keeps hitting, not a
   preference, and everything else is easier once the ship stops turning by
   itself.
2. **Q / E roll and W / S throttle.** Small, and they are most of what makes a
   ship feel like a ship.
3. **Right click as the secondary weapon**, shield moved to F. One line each,
   and it is the most universal convention in the genre.
4. **1-6 weapon slots**, with what we have today in slots 1, 2 and 4.
5. Autopursuit, and new weapon types to put in the empty slots.
