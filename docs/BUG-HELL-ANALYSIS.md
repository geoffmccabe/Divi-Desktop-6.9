# Why the node-management code keeps breaking, and how to get out

Written 2026-Sep-21, after fourteen releases in about thirty hours (69.13.1
through 69.13.14). Geoff's request: "analyze the last 15 or so bug fixes to
see what's going on and why this keeps not working." This is that analysis.
It is honest about what was pre-existing, what I broke, and what is
structurally wrong. It contains no code.

---

## 1. The short version

There is no single place in the wallet that knows whether the node is
running. There are **fifteen different functions** that each form their own
opinion from their own evidence, and **twelve different places** that can
start or stop the node, with nothing coordinating them. Every bug of the last
two days was one of those opinions being wrong, or two of those actors
stepping on each other.

I did not create that architecture. But I added the watchdog on top of it,
which made a fifth independent actor with its own opinion — and the watchdog
is what turned a Mac that worked into one that restarted its node every ten
minutes, and later left it wedged for fifteen hours. So Geoff's claim is
partly right: **the Mac was working before the watchdog.** Windows, on the
other hand, had never worked at all, for a reason nobody had found.

The fixes since then have each been correct in isolation and have each
narrowed the gap. But they were patches to symptoms of one structural flaw,
so each one exposed the next symptom. That is what "Bug Hell" feels like
from the inside, and it will not end by patching harder.

---

## 2. What was actually pre-existing versus what I broke

Being precise about this matters, because the fix is different for each.

### Pre-existing bugs I found and fixed (not mine)

| Bug | Effect | Since when |
|---|---|---|
| Windows folder path handed to the node in a form its database could not read | **Every Windows node ever started under DD69 died on launch.** Joseph, Jim, and every other Windows tester. | Always |
| Node writes no process-id file on Windows, and everything checked for one | Wallet could never see its own node on Windows | Always |
| Unreadable wallet lock state reported as "unlocked" | Send button did nothing; staking silently refused | Always |
| Unreadable sync state reported as "syncing" | Start Staking blanked the balance | Always |
| Diagnostic quoted "RPCAcceptHandler" chatter as cause of death | Every "the node stopped, its last message was…" ever shown was noise | Always |
| Chart stylesheet present twice, older copy clipping the axis | Chart bottom cut off | Weeks |
| Update check once per hour | New versions invisible for up to an hour | Weeks |
| Antivirus check spawned visible PowerShell twice a second | Joseph's console-window storm | Weeks |
| Clipboard write after an await | Copy Setup Log always failed | Weeks |
| Staking dropdown deleting the node's own reason | "It won't stake, it just doesn't work" | Weeks |
| Snapshot published with no checksum | 5 GB downloads never verified | Always |

These are real, and they are why Windows is closer to working now than it
has ever been. Joseph's last log shows a node that started, opened every
database, and synced — for the first time.

### Bugs I introduced (mine)

| Bug | How | Fixed in |
|---|---|---|
| Watchdog restarted a healthy node every ten minutes | Trusted a single probe; two minutes of patience against a fifteen-minute shutdown | 69.13.2 |
| Watchdog then could not restart a wedged node for fifteen hours | Over-corrected: any log activity, including peer-connection noise, cancelled the strikes | 69.13.14 |
| Watchdog could not stop a wedged node at all | The stop path required the RPC the wedged node cannot answer | 69.13.14 |
| Watchdog started a second node on top of a healthy one on Windows | My new actor consulted the pre-existing broken "is it running" check | 69.13.12 |
| Snapshot unpacked over a running node | Consequence of the above: wallet believed node had failed | 69.13.11 |
| Map "frozen" warning fired after sleep or background | Measured time passed, not failures | 69.13.13 |
| Crash classifier briefly matched harmless "Error:" lines | Broadened a match without excluding noise | 69.13.8 |

**Pattern:** every one of my bugs is the watchdog or something feeding it.
The watchdog is a fifth opinion about node state, added to a system that
already had four contradictory ones, with the power to kill and restart.
That was the wrong thing to add to this codebase as it stands.

---

## 3. The structural problems, with evidence

### 3.1 No single source of truth for "is the node running?"

Fifteen functions across ten files each answer some version of this
question from different evidence:

- a process-id file (which Windows never writes)
- a TCP connection to the RPC port
- a one-shot RPC probe (three-way answer)
- a timestamp of the last successful RPC call
- whether the node's log file has grown
- the age of the newest block
- a regex over the last 400 lines of the node's log
- and in the UI, four separate components polling on their own clocks and
  keeping their own copies of the answer

They disagree constantly, because they are measuring different things at
different moments. The Spendable panel, the map, the staking button, the
bottom-left status and the watchdog have all, this week, held different
beliefs about the same node at the same time. **This is the root cause of
essentially every bug in the last two days.**

### 3.2 Twelve uncoordinated actors can start or stop the node

Bring-up, the watchdog, the snapshot installer, the repair ladder, the
Windows-crash retry loop, the quit handler, and the command-line tool can
each spawn or stop a node. None of them holds a lock. None of them asks the
others. This is how two nodes got started on Joseph's machine and how a
snapshot got unpacked under a live one. A second node on Windows *cannot* be
prevented by making the checks smarter, because the checks are the thing
that disagrees. It can only be prevented by having one owner.

### 3.3 "Failed to find out" is systematically reported as a definite answer

I fixed this exact mistake **seven times** this session, in seven places:

1. wallet lock state → "unlocked"
2. sync state → "syncing"
3. watchdog probe → "wedged"
4. process-id file absent → "not running"
5. map poll gap → "frozen"
6. node's last error → RPC chatter
7. log activity → "busy"

Seven is not seven bugs. Seven is one missing concept. The code uses
yes/no everywhere it needs **yes / no / don't know**. Every place that
reads node state should be forced, by its type, to say what it does when it
doesn't know. Until that exists, this mistake will be re-made by the next
person (or the next me) who touches any of these files.

### 3.4 Diagnostics work by searching the node's log for English phrases

Thirteen places grep the node's output for words like "Error:", "corruption",
"Assertion failed", "Unable to bind", "connect() to". The lists of what
counts as fatal and what counts as noise are now **duplicated in two files**
and were built one incident at a time. Every new message the node can emit
needs another patch, and a wrong guess either hides a real crash or (as
happened) reports noise as one.

### 3.5 Platform assumptions are scattered

The Windows no-console flag is defined in **seven separate places**. The
process-id assumption, the path normalisation, the signal-to-stop, the
"vanished with no output" message, the process-liveness check — each is
platform-specific and each lives wherever it was first needed. The
LevelDB path bug survived for the entire life of the project because
nobody had a single place to look for "what do we do differently on
Windows."

### 3.6 Seven tuned constants in the watchdog alone

Check interval, strike count, probe timeout, traffic-freshness window,
minimum time between restarts, maximum silence, maximum time not listening.
Each was set or changed after an incident. They interact: the silence cap
must exceed the flush time, which must be less than the restart spacing,
which must exceed the strike window. Nobody can reason about all seven at
once, which is exactly why the watchdog has swung from too aggressive to
too passive and back.

### 3.7 The wallet's own polling helps wedge the node

Fifteen UI components poll the node independently. The node answers RPC on a
limited number of worker threads, and a kept-alive connection holds one.
The wallet has a six-call limit in flight, but fifteen pollers on fifteen
clocks still produce a steady load — and the node has now wedged on
Geoff's Mac three times this week. **The wallet is a contributor to the
condition its watchdog exists to cure.**

### 3.8 The code reads as an incident log

Twenty-five comments across sixteen files now say "Geoff, 2026-Sep-2x: …"
followed by a paragraph. I wrote them, they are accurate, and they are a
symptom. When a file's comments are a chronological list of things that
went wrong, the file has been patched rather than designed.

### 3.9 Fourteen releases, zero test environments

Every fix was verified only by compiling, running unit tests, and asking a
real user in another country to try it. There is no Windows machine in the
loop. There is no automated test that starts a real node. The release
itself is a forty-line manual ritual I performed fourteen times by hand.
This is a process problem, not a code problem, but it is the reason the
last two days felt infinite: every mistake reached a user before it
reached me.

---

## 4. What is genuinely better than two days ago

It would be dishonest to leave this out:

- Windows nodes now start. They never had.
- Sends and staking work when the wallet is locked, with the reason shown.
- The snapshot is ours, verified, resumable, and refreshed on a schedule.
- Updates are noticed in minutes.
- Diagnostics are short enough to send and read the node's real output.
- The crash that "explained" every Windows failure was a symptom of our own
  path bug, which is now impossible to reintroduce.

The problem is not that the fixes were wrong. It is that the ground they
were built on cannot hold them.

---

## 5. The way out

Not a rewrite. One focused restructuring of one subsystem, done once,
followed by a change in how releases happen.

### 5.1 One Node Supervisor, the only owner of the node

A single component that alone may start, stop, or restart the node, and
that alone decides what state it is in. Everything else — bring-up,
watchdog, snapshot, quit, the UI — sends it a *request* and reads its
*answer*. It keeps the process handle, the process id, and the launch log.
It runs one poll loop. There is one state machine with explicit states:

> not installed → stopped → starting → loading the chain → running →
> stopping → wedged

plus **unknown**, as a first-class state with a reason attached.

This alone makes the two-nodes-at-once bug and the snapshot-over-a-live-node
bug structurally impossible, rather than "prevented if every check agrees."

### 5.2 A three-way answer type, used everywhere node state is read

Replace every yes/no about the node with **yes / no / don't know (why)**.
The compiler then refuses to let anyone forget the third case. This
eliminates the class of bug I fixed seven times, permanently, at the point
where it is cheapest to eliminate: the type.

### 5.3 The UI stops asking the node and starts listening to the supervisor

Fifteen pollers become zero. The supervisor publishes one status object
whenever anything changes; every panel renders from it. Panels can no longer
disagree, the node's RPC load drops by most of the wallet's share, and the
wedging that started all this becomes far rarer.

### 5.4 One platform module

Every Windows/macOS/Linux difference in one file: how to spawn without a
console, how to find out whether a process is alive, how to normalise a
path, how to ask a process to stop politely. Tested per platform. The next
LevelDB-path-class bug gets found in one place instead of surviving for a
year.

### 5.5 One diagnosis module, tested against real captured output

All classification of the node's log and exit — fatal, corrupt, needs
reindex, noise — in one file, driven by a table, with a test suite built
from the actual lines Joseph and Geoff sent this week. Never again a regex
on "Error:" in a random file.

### 5.6 Move the incident narratives out of the code

Into a `docs/POSTMORTEMS.md`. The code keeps one-line "why" comments. The
history stays findable without making every file a diary.

### 5.7 Change the release process

- **A Windows test machine in the loop** before anything is published — a
  VM, or a GitHub Actions job that actually launches the node against a
  test network and waits for it to answer. Every Windows bug this week
  would have been caught here.
- **One release script** replacing the manual ritual. Fourteen hand-runs of
  a forty-line procedure is fourteen chances for the wrong-version mistake
  I nearly made twice.
- **Batch fixes; publish at most daily** unless a release is unusable.
  Version-per-fix is what made this feel endless.

### 5.8 Order of work

1. Windows test environment (5.7) — first, because nothing else can be
   verified without it.
2. The three-way answer type (5.2) — small, mechanical, and it hardens
   everything that follows.
3. The Node Supervisor (5.1) — the real restructuring. Bring-up, watchdog,
   snapshot and quit move onto it one at a time, each behind a test.
4. UI listens instead of polls (5.3).
5. Platform and diagnosis modules (5.4, 5.5).
6. Comments out, postmortems in (5.6).

Steps 1–3 are the escape. Steps 4–6 are how it stays escaped.

---

## 6. What I would ask of Geoff

- **Freeze feature work on anything touching the node** until step 3 is
  done. Each feature added now lands on the same unstable ground.
- **Accept fewer releases.** The cadence of the last two days was driven by
  wanting each fix in a user's hands immediately; it is also what made each
  fix reach a user before it was proven.
- **Decide whether the watchdog should exist at all** in the meantime. The
  honest position: with the fixes in 69.13.14 it is probably now
  net-positive, but it is the component that has caused the most damage,
  and disabling it until the supervisor exists is a defensible choice.
