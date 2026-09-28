// The card picture: the arithmetic, and the two copies of the size rule.
//
// Run: sh scripts/run-rebels-gameimage-tests.sh
//
// Most of gameImage.ts needs a browser. What does not is the fitting
// arithmetic and the rule about what counts as a card, and the second of those
// exists TWICE on purpose - once where a card is made and once in the
// validator the saver runs - because a cap enforced only by the uploader is
// not a cap. Two copies of a rule is a bug waiting unless something asserts
// they agree, so that is what this mostly does.
export {};

import { placeIn, cardImageOk, CARD_W, CARD_H, CARD_MAX_CHARS } from "./gameImage";
import { IMAGE_MAX_CHARS, validateGame, waveDefence } from "./gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ================= THE TWO COPIES OF THE RULE ================= */
{
  ok("the card cap is the same number in both places",
     CARD_MAX_CHARS === IMAGE_MAX_CHARS, `${CARD_MAX_CHARS} against ${IMAGE_MAX_CHARS}`);

  /* And they agree about the same pictures, not merely about the number. */
  const real = `data:image/webp;base64,${"A".repeat(200)}`;
  const g = { ...waveDefence(), image: real };
  ok("a real card passes both", cardImageOk(real) && "ok" in validateGame(g));

  const cases: Array<[string, unknown]> = [
    ["a PNG data URL", `data:image/png;base64,${"A".repeat(200)}`],
    ["a link instead of an upload", "https://example.com/card.png"],
    ["something far too big", `data:image/webp;base64,${"A".repeat(CARD_MAX_CHARS)}`],
    ["an empty string", ""],
    ["a number", 42],
    ["base64 with characters base64 does not have", `data:image/webp;base64,${"!".repeat(200)}`],
  ];
  for (const [what, v] of cases) {
    const a = cardImageOk(v);
    const b = "ok" in validateGame({ ...waveDefence(), image: v });
    ok(`both refuse ${what}`, !a && !b, `maker ${a ? "took" : "refused"}, validator ${b ? "took" : "refused"}`);
  }
}

/* ================= THE SHAPE, AND FITTING INTO IT ================= */
{
  ok("the card is three by two", CARD_W / CARD_H === 1.5, `${CARD_W}x${CARD_H}`);

  /* COVER fills the card and loses the overflow. A wide picture keeps its
     height and spills off the sides; a tall one keeps its width. */
  const wide = placeIn(3000, 1000, "cover");
  ok("a wide picture covers the card and spills sideways",
     Math.abs(wide.h - CARD_H) < 0.001 && wide.w > CARD_W && wide.x < 0,
     `${wide.w.toFixed(0)}x${wide.h.toFixed(0)} at ${wide.x.toFixed(0)}`);
  const tall = placeIn(1000, 3000, "cover");
  ok("a tall one covers it and spills up and down",
     Math.abs(tall.w - CARD_W) < 0.001 && tall.h > CARD_H && tall.y < 0,
     `${tall.w.toFixed(0)}x${tall.h.toFixed(0)} at ${tall.y.toFixed(0)}`);
  const exact = placeIn(1500, 1000, "cover");
  ok("a picture already three by two fits exactly, with nothing cropped",
     Math.abs(exact.w - CARD_W) < 0.001 && Math.abs(exact.h - CARD_H) < 0.001
       && Math.abs(exact.x) < 0.001 && Math.abs(exact.y) < 0.001);

  /* CONTAIN fits the whole picture and leaves bars. */
  const fitted = placeIn(3000, 1000, "contain");
  ok("contain keeps the whole picture inside the card",
     fitted.w <= CARD_W + 0.001 && fitted.h <= CARD_H + 0.001 && fitted.x >= -0.001 && fitted.y >= -0.001,
     `${fitted.w.toFixed(0)}x${fitted.h.toFixed(0)} at ${fitted.x.toFixed(0)},${fitted.y.toFixed(0)}`);

  /* Both always centre it. */
  for (const fit of ["cover", "contain"] as const) {
    const p = placeIn(700, 2300, fit);
    ok(`${fit} centres what it draws`,
       Math.abs((p.x + p.w / 2) - CARD_W / 2) < 0.001 && Math.abs((p.y + p.h / 2) - CARD_H / 2) < 0.001);
  }

  /* A picture with no size cannot make the maths produce NaN and a blank
     card: a zero-byte or broken file is a real thing to be handed. */
  const nothing = placeIn(0, 0);
  ok("a picture of no size still lands on the card rather than on NaN",
     Number.isFinite(nothing.w) && nothing.w === CARD_W && nothing.h === CARD_H);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
