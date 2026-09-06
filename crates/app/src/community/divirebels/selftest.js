// Divi Rebels self test.
//
// This file holds ONLY the tests. It is spliced onto a copy of index.html by
// scripts/run-divirebels-tests.sh at run time, rather than embedding a copy of
// the game, because an embedded copy is how a test quietly starts passing
// against code that no longer ships.
//
// The tests drive the simulation directly (updateCommon plus the wave update
// for the current wave) instead of waiting on animation frames, so a minute of
// game time runs in well under a second and the result is deterministic.
//
// Run: sh scripts/run-divirebels-tests.sh

(function () {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? "PASS " : "FAIL ") + name + (extra ? "  [" + extra + "]" : ""));
  const step = (n, dt, after) => {
    for (let i = 0; i < n; i++) {
      updateCommon(dt);
      if (Game.wave === 1) updateWave1(dt); else if (Game.wave === 2) updateWave2(dt); else updateWave3(dt);
      Game.t += dt;
      if (after) after();
    }
  };
  try {
    // 1. a bolt lined up on an enemy kills it. The enemy is pinned to the axis
    //    each frame because the real ones weave, which is the whole point of
    //    them and would make this test measure the weave, not the collision.
    Game.mode = "play"; Game.wave = 1; Game.loop = 1; Game.score = 0; Game.shield = 6;
    Game.target = 999; Game.progress = 0; clearWorld();
    Game.px = 0; Game.py = 0; Game.vx = 0; Game.vy = 0;
    Input.aimX = 0; Input.aimY = 0; Input.firing = true;
    const mark = { x: 0, y: 0, z: 600, phase: 0, speed: 0, hp: 1, kind: "int",
                   scale: 16, roll: 0, rollv: 0, fireAt: 1e9 };
    W.enemies.push(mark);
    const pin = () => { mark.x = 0; mark.y = 0; };
    step(90, 1/60, pin);
    ok("bolt kills a lined-up enemy", W.enemies.indexOf(mark) === -1);
    ok("kill scores points", Game.score >= 100, "score " + Game.score);
    ok("kill counts toward the wave", Game.progress >= 1, "progress " + Game.progress);

    // 2. a bolt well off to the side must not
    Game.score = 0; Game.progress = 0; clearWorld(); Input.firing = true;
    const wide = { x: 260, y: 0, z: 600, phase: 0, speed: 0, hp: 1, kind: "int",
                   scale: 16, roll: 0, rollv: 0, fireAt: 1e9 };
    W.enemies.push(wide);
    step(90, 1/60, () => { wide.x = 260; wide.y = 0; });
    ok("a bolt does not hit what it is not aimed at", W.enemies.indexOf(wide) !== -1);

    // 3. incoming fire
    clearWorld(); Input.firing = false; Game.shield = 6; Game.px = 0; Game.py = 0;
    Input.aimX = 0; Input.aimY = 0;
    W.fire.push({ x: 0, y: 0, z: 300, vx: 0, vy: 0, vz: -600, life: 4 });
    step(60, 1/60);
    ok("incoming fire hurts", Game.shield === 5, "shield " + Game.shield);

    clearWorld(); Game.shield = 6;
    W.fire.push({ x: 400, y: 0, z: 300, vx: 0, vy: 0, vz: -600, life: 4 });
    step(60, 1/60);
    ok("a miss does not hurt", Game.shield === 6, "shield " + Game.shield);

    // 4. shooting down an incoming shot
    clearWorld(); Game.shield = 6; Game.score = 0; Input.firing = true;
    Game.px = 0; Game.py = 0; Input.aimX = 0; Input.aimY = 0;
    const shot = { x: 0, y: 0, z: 500, vx: 0, vy: 0, vz: -120, life: 8 };
    W.fire.push(shot);
    step(90, 1/60, () => { W.enemies.length = 0; });
    ok("incoming fire can be shot down",
       W.fire.indexOf(shot) === -1 && Game.shield === 6 && Game.score >= 25, "score " + Game.score);

    // 5. no shields ends the run
    clearWorld(); Input.firing = false; Game.shield = 1; Game.mode = "play";
    W.fire.push({ x: 0, y: 0, z: 200, vx: 0, vy: 0, vz: -600, life: 4 });
    step(60, 1/60);
    ok("no shields ends the run", Game.mode === "dead", "mode " + Game.mode);

    // 6. surface wave
    Game.mode = "play"; Game.wave = 2; Game.shield = 6; Game.score = 0;
    Game.target = 3000; Game.progress = 0; clearWorld();
    Game.py = TR_FLOOR + 60; Game.px = 0; Game.vx = 0; Game.vy = 0;
    Input.aimX = 0; Input.aimY = TR_FLOOR + 60; Input.firing = true;
    const tw = { x: 0, z: 700, h: 120, gun: false, alive: true, fireAt: 1e9 };
    W.towers.push(tw);
    step(120, 1/60);
    ok("surface wave advances", Game.progress > 100, "progress " + Math.round(Game.progress));
    ok("towers can be destroyed", !tw.alive);

    // 7. surface wave completes at its target
    Game.mode = "play"; Game.progress = 2990; Game.target = 3000; clearWorld();
    step(30, 1/60);
    ok("surface wave completes", Game.mode === "clear", "mode " + Game.mode);

    // 8. trench
    Game.mode = "play"; Game.wave = 3; Game.loop = 1; Game.shield = 6;
    Game.target = 3400; Game.progress = 0; clearWorld(); buildTrench();
    ok("trench has obstacles", W.bars.length + W.turrets.length >= 10, "bars " + W.bars.length + " turrets " + W.turrets.length);
    ok("trench has a port", !!W.port, "need " + (W.port ? W.port.need : "-"));
    W.bars.length = 0; W.turrets.length = 0;
    W.port.z = 800;
    Game.px = 0; Game.py = TR_FLOOR + 26; Game.vx = 0; Game.vy = 0;
    Input.aimX = 0; Input.aimY = TR_FLOOR + 26; Input.firing = true;
    let guard = 0;
    while (Game.mode === "play" && guard++ < 400) step(1, 1/60);
    ok("the port can be destroyed", Game.mode === "clear", "mode " + Game.mode);

    // 9. flying into a catwalk costs a shield
    Game.mode = "play"; Game.wave = 3; Game.shield = 6; Game.progress = 0;
    clearWorld(); Input.firing = false;
    Game.py = 0; Game.px = 0; Game.vx = 0; Game.vy = 0; Input.aimX = 0; Input.aimY = 0;
    W.bars.push({ kind: "h", z: 300, y: 0, thick: 14 });
    step(90, 1/60);
    ok("hitting a catwalk hurts", Game.shield === 5, "shield " + Game.shield);

    // 10. and flying through the gap does not
    Game.mode = "play"; Game.shield = 6; clearWorld();
    Game.py = TR_ROOF - 20; Input.aimY = TR_ROOF - 20;
    W.bars.push({ kind: "h", z: 300, y: TR_FLOOR + 20, thick: 14 });
    step(90, 1/60);
    ok("clearing a catwalk does not", Game.shield === 6, "shield " + Game.shield);

    // 11. waves cycle
    Game.wave = 3; Game.loop = 1; nextWave();
    ok("wave 3 rolls into a new loop", Game.wave === 1 && Game.loop === 2, "w" + Game.wave + " l" + Game.loop);

    // 12. long unattended runs
    for (const w of [1, 2, 3]) {
      Game.wave = w; Game.loop = 3; Game.shield = 999; Game.score = 0;
      Game.target = w === 1 ? 99999 : 4200; Game.progress = 0;
      clearWorld(); if (w === 3) buildTrench();
      Game.mode = "play"; Input.firing = true;
      /* Wave two and three end at their target, so let them roll over rather
         than freezing progress, which is what actually happens in play. */
      for (let k = 0; k < 3600; k++) {
        step(1, 1/60);
        if (Game.mode !== "play") { Game.mode = "play"; Game.progress = 0; clearWorld(); if (w === 3) buildTrench(); }
      }
      const n = W.enemies.length + W.towers.length + W.bars.length + W.turrets.length +
                W.fire.length + W.bolts.length + W.shards.length;
      ok("wave " + w + " survives 60s unattended with no runaway", n < 700, "live objects " + n);
    }
  } catch (e) {
    out.push("FAIL threw: " + (e && e.message) + " @ " + (e && e.stack ? e.stack.split("\n")[1] : ""));
  }
  document.getElementById("result").textContent = out.join(" || ");
})();
