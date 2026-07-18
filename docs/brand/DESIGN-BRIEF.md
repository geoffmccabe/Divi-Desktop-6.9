# Divi Love — Design Brief for the website (divi.love)

**Goal:** the website must look like it was cut from the same cloth as the Divi
Desktop 6.9 wallet. Everything below is extracted from the wallet's real code,
not invented, so matching it is mechanical rather than a matter of taste.

Pair this brief with **`divi-love-design-system.css`** — that file already
contains the exact tokens, the animated backdrop, the frosted panels, the
buttons and the motion. Link it and the look comes for free.

---

## 1. The look in one paragraph

A dark, calm, "deep space" interface. The background is a near-black indigo with
a **slowly breathing hexagon grid** drifting over it. Content sits on **frosted
glass panels** — translucent, blurred, with a soft **purple glow** that
intensifies when you hover. Text is near-white on dark; secondary text is grey.
Purple is the signature colour and is used for anything active or important;
green means healthy/confirmed, amber means attention, red means danger. Numbers
are large and tabular, with their decimals and units set smaller and grey.
Motion is subtle and meaningful — nothing bounces or slides for decoration.

---

## 2. Palette (exact values — do not substitute)

Colours are stored as HSL triplets so opacity is easy (`hsl(var(--primary) / 0.4)`).

| Token | Value | Meaning |
|---|---|---|
| `--background` | `240 6% 10%` | near-black, slightly blue |
| `--foreground` | `0 0% 95%` | body text |
| `--primary` | `280 80% 60%` | **Divi purple — the signature colour** |
| `--accent` | `320 70% 55%` | pink, a sparing counterpoint |
| `--muted-foreground` | `0 0% 70%` | labels, secondary text |
| `--border` | `240 4% 25%` | hairlines |
| `--success` | `142 76% 36%` | healthy / confirmed |
| `--warning` | `45 93% 47%` | attention |
| `--destructive` | `0 84% 60%` | danger |
| gold pulse | `48 100% 58%` | "this just updated" |

**Purple is the brand.** Glows, active states, links, primary buttons and bullet
points are all purple. Pink is a highlight, not a co-star.

---

## 3. Non-negotiables (the things that make it "the app")

1. **The animated hex-grid backdrop.** Two hexagon grids (one white, one black)
   cross-fade over 20 seconds above an indigo radial wash. This is the single
   most recognisable element. Do not replace it with a flat colour or a photo.
2. **Frosted glass panels with a purple glow.** Translucent (85%), 24px blur,
   12px corners, and a purple halo that strengthens on hover.
3. **Black cards on the dark surface.** Nested content sits in near-black cards
   (`.dl-card`) on top of the panel — that layered depth is the app's structure.
4. **Big numbers, small grey units.** A figure is set large; its decimals and
   its unit ("DIVI", "USD") are ~60% size and grey, sitting on the same baseline.
5. **Restraint.** No gradients on text, no drop shadows on type, no decorative
   animation. The backdrop moves; the content does not.

---

## 4. Structure to use

```html
<body>
  <div class="dl-backdrop"><div class="dl-wash"></div></div>

  <main class="dl-page">
    <header class="dl-center dl-narrow">
      <h1>The Divi Love Project</h1>
      <p class="dl-lede">One sentence on what this all is.</p>
    </header>

    <!-- One of these per feature -->
    <section class="dl-card dl-feature">
      <div class="dl-feature-head">
        <h2 class="dl-feature-title">Divi Desktop 6.9</h2>
        <span class="dl-pill dl-pill-live">Live</span>
      </div>
      <p class="dl-feature-sub">A ground-up rebuild of the wallet.</p>

      <div class="dl-feature-body">
        <div>
          <ul class="dl-bullets">
            <li>Point one.</li>
            <li>Point two.</li>
          </ul>
        </div>
        <div>
          <!-- Video OR image — same frame either way -->
          <div class="dl-media">
            <video src="/media/wallet.mp4" autoplay muted loop playsinline></video>
          </div>
          <p class="dl-caption">Optional caption.</p>
        </div>
      </div>
    </section>
  </main>
</body>
```

**Media slots.** `.dl-media` is a 16:9 frame that already carries the app's
border, glow and rounded corners. Drop a `<video>`, `<img>` or `<iframe>` inside
and it fits automatically. Use `.dl-media-tall` for 4:3 or `.dl-media-auto` to
let the asset set its own height. Alternate which side the media sits on from
section to section so the page has rhythm; on narrow screens it stacks by itself.

**Status pills.** `.dl-pill-live` (green), `.dl-pill-soon` (amber),
`.dl-pill-new` (purple). Use these honestly — some parts of the project are
shipped and some are still being built, and the page should say which.

---

## 5. Typography

- One system font stack for everything (headings and body) — the wallet uses the
  OS font deliberately so it feels native. Don't add a display font.
- Headings are tight (`line-height: 1.2`, slight negative letter-spacing); body
  is airy (`1.6`).
- Monospace (`--font-mono`) only for addresses, hashes and figures — never for
  prose.

---

## 6. Motion

- **Backdrop:** the 20-second hex-grid breathe. Always on.
- **Hover:** panels brighten their glow over 0.3s. That's the main interaction.
- **Gold flash:** the app pulses a value bright gold for 3 seconds whenever it
  updates, fading back to its own colour. On the website this is a nice touch for
  a live stat (price, block height) — use `.gold-flash`, sparingly.
- Everything respects `prefers-reduced-motion`.

---

## 7. Logo

Use the Divi Love heart mark (the dark heart with the purple "D" wing) —
`crates/app/icons/icon.png` in the wallet repo is the master. It sits on dark
backgrounds as-is.

---

## 8. Page outline to build

Hero, then one section per item, each with a media slot:

1. **Divi Desktop 6.9** — the rebuilt wallet.
2. **The Blockchain Refactor** — the modernised core.
3. **New Opcodes** — native chain support for the apps.
4. **Proof of Existence** — timestamp any file.
5. **Divi Collectibles (NFDs)** — NFTs that actually contain the art.
6. **Divi Love Scanner** — the block explorer, with the Inspector.
7. **Love Nodes** — staking from a phone.
8. **Divi Everywhere Bridge (DEB)** — reaching Ethereum and beyond.

Copy for each section is supplied separately. Keep claims exactly as written —
several of them are deliberately worded to stay honest about limits.
