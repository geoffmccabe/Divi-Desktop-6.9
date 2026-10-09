// The NFDs tab of the inventory: the Divi collectibles this wallet holds.
//
// Geoff, 2026-Oct-08: "NFDs appear in Inventory on an NFDs tab... the top Tier
// of NFD owned by the user get 1% bonus per tier in damage applied, damage
// resistance and the chance to get a drop... with the highest tier NFD on top
// as ACTIVE. Can you design something very nice for this?"
//
// ---- THE DESIGN, AND WHY IT IS THIS ----
// One card is doing all the work. Everything else a player owns is worth
// nothing at all while a higher tier is in the wallet, and a grid of equal
// looking cards would hide exactly that. So the panel is a HERO and a shelf:
// the active collectible is large, in colour, with the three numbers it is
// paying out written next to it, and the rest sit below it quietly. The three
// numbers carry a bar each, scaled to the best tier the set can reach, so the
// player can see how much of the set's power they have and how much is still
// out there. That is the whole point of a collection.
//
// Sealed packs get their own shelf and the packaged art, because an unopened
// pack is worth nothing until it is revealed and must not look like something
// that is working.

import { useEffect, useState } from "react";
import { cssAspect, topTierOf, type NfdCollection } from "../../nfd/nfdCatalog";
import { itemForOwned, type OwnedNfd } from "../../nfd/nfdOwned";
import { benefitLines, type NfdBenefits } from "./nfdBenefits";
import { NFD_EMPTY, nfdWhyText, readNfdOwnership, type NfdOwnershipState } from "./nfdOwnership";

/**
 * The rarity colour for a tier, as a share of the best the set can reach.
 *
 * Banded rather than interpolated. A smooth ramp would run violet to gold
 * through the long way round the colour wheel and spend most of the set in
 * muddy greens; five bands read as five rarities, which is what a tier IS.
 */
export function nfdTierColour(tier: number, best: number): string {
  if (tier <= 0) return "250 10% 55%";
  const f = best > 0 ? Math.min(1, tier / best) : 0;
  if (f >= 0.9) return "45 100% 62%";
  if (f >= 0.65) return "320 90% 66%";
  if (f >= 0.4) return "265 85% 72%";
  if (f >= 0.2) return "212 85% 66%";
  return "186 70% 58%";
}

export function NfdsTab() {
  const [s, setS] = useState<NfdOwnershipState>(NFD_EMPTY);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let alive = true;
    setS((p) => ({ ...p, why: "loading" }));
    void readNfdOwnership().then((next) => { if (alive) setS(next); });
    return () => { alive = false; };
  }, [reloads]);

  const all = s.groups.flatMap((g) => g.owned.map((o) => ({ g, o })));
  const active = all.find(({ o }) => o.tier != null && o.tier === s.tier) ?? null;
  const rest = all.filter((x) => x !== active && x.o.tier != null);
  const sealed = all.filter((x) => x.o.tier == null);

  return (
    <div className="nfd-tab">
      {s.why !== "owned" && (
        <div className="nfd-empty">
          <p>{nfdWhyText(s.why, s.collections.length)}</p>
          {(s.why === "no-chain" || s.why === "none-owned") && (
            <button type="button" onClick={() => setReloads((n) => n + 1)}>LOOK AGAIN</button>
          )}
        </div>
      )}

      {active && (
        <ActiveCard collection={active.g.collection} owned={active.o} benefits={s.benefits}
          alsoHeld={new Set(all.map(({ o }) => o.tier).filter((t): t is number => t != null))} />
      )}

      {rest.length > 0 && (
        <section className="nfd-shelf">
          <h4>ALSO OWNED <span>{rest.length}</span></h4>
          <p className="nfd-shelf-why">
            Held, and worth nothing while the card above is in your wallet. Only your best tier pays out.
          </p>
          <div className="nfd-grid">
            {rest.map(({ g, o }) => <SmallCard key={o.id} collection={g.collection} owned={o} />)}
          </div>
        </section>
      )}

      {sealed.length > 0 && (
        <section className="nfd-shelf">
          <h4>SEALED PACKS <span>{sealed.length}</span></h4>
          <p className="nfd-shelf-why">
            Not opened yet, so nothing is known about them and nothing is paid out. Unpackaging comes next.
          </p>
          <div className="nfd-grid">
            {sealed.map(({ g, o }) => <SmallCard key={o.id} collection={g.collection} owned={o} />)}
          </div>
        </section>
      )}

      {s.collections.length > 0 && (
        <section className="nfd-sets">
          <h4>SETS THAT COUNT <span>{s.collections.length}</span></h4>
          <div className="nfd-sets-rows">
            {s.collections.map((c) => {
              const held = s.groups.find((g) => g.collection.id === c.id)?.owned.length ?? 0;
              return (
                <div key={c.id} className={"nfd-set-row" + (held ? " on" : "")}>
                  {c.logo && <img src={c.logo} alt="" />}
                  <div>
                    <b>{c.name}</b>
                    <em>
                      {c.items.length} pieces, best tier {topTierOf(c)}
                      {held ? ` · you hold ${held}` : " · you hold none"}
                    </em>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** The one card that is paying out, and what it is paying. */
function ActiveCard({
  collection, owned, benefits, alsoHeld,
}: { collection: NfdCollection; owned: OwnedNfd; benefits: NfdBenefits; alsoHeld: Set<number> }) {
  const best = topTierOf(collection);
  const item = itemForOwned(collection, owned);
  const colour = nfdTierColour(owned.tier ?? 0, best);
  const lines = benefitLines(benefits);
  /* The bar is the share of the set's OWN best tier, not of a hundred percent.
     A tier 12 of a set that stops at 30 is a long way from the top and should
     look it; against a hundred it would look like a failure instead. */
  const share = best > 0 ? Math.min(1, (owned.tier ?? 0) / best) : 0;
  return (
    <section className="nfd-active" style={{ ["--nfd" as string]: colour }}>
      <div className="nfd-active-art" style={{ ["--nfd-aspect" as string]: cssAspect(collection.aspectRatio) }}>
        {item?.media.image
          ? <img src={item.media.image} alt={item.name} />
          : <span className="nfd-noart">no art</span>}
        <b className="nfd-active-tag">ACTIVE</b>
        {owned.ultraRare != null && <b className="nfd-ur-tag">ULTRA RARE {owned.ultraRare}</b>}
      </div>
      <div className="nfd-active-main">
      <div className="nfd-active-text">
        <span className="nfd-tierline">
          TIER {owned.tier ?? 0}<i> of {best}</i>
        </span>
        <h5>{item?.name ?? "unknown piece"}</h5>
        <em>{collection.name}</em>
        {item?.description && <p className="nfd-active-desc">{item.description}</p>}
      </div>
      {/* ---- the ladder ----
          One rung per tier in the set, yours lit, the ones you also hold half
          lit. A collection is a ladder and a single "tier 23" number does not
          say whether that is near the top or nowhere near it; this does, at a
          glance, and it is the thing that makes a player want the next one. */}
      <div className="nfd-ladder" aria-hidden="true">
        {Array.from({ length: best }, (_, i) => {
          const t = i + 1;
          const state = t === owned.tier ? " on" : alsoHeld.has(t) ? " held" : "";
          return (
            <i key={t} className={"nfd-rung" + state}
              style={{ ["--rung" as string]: nfdTierColour(t, best), height: `${30 + (t / best) * 70}%` }} />
          );
        })}
      </div>
      {/* Its own row rather than a block under the name, so a wide panel
          spreads the three numbers across the width instead of leaving most
          of the row empty. Narrow, they stack and nothing is lost. */}
      <div className="nfd-pays">
        <div className="nfd-benefits">
          {lines.map((l) => (
            <div key={l.label} className="nfd-benefit">
              <span className="nfd-benefit-label">{l.label}</span>
              <span className="nfd-benefit-value">{l.value}</span>
              <span className="nfd-benefit-bar"><i style={{ width: `${share * 100}%` }} /></span>
            </div>
          ))}
        </div>
        {/* ⚠ OUTSIDE the grid above, not a cell spanning it. A cell spanning
            every column keeps every column occupied, and an occupied column
            is one auto-fit will not collapse, so the three readouts stayed
            150px wide in a 1357px row. Measured, not guessed. */}
        <p className="nfd-benefit-note">
          One percent of each, per tier. Tier {owned.tier ?? 0} of a possible {best}.
        </p>
      </div>
      </div>
    </section>
  );
}

/** One of the rest: art, tier, and nothing claiming to be working. */
function SmallCard({ collection, owned }: { collection: NfdCollection; owned: OwnedNfd }) {
  const best = topTierOf(collection);
  const item = itemForOwned(collection, owned);
  const art = item?.media.image ?? collection.packagedArt;
  const colour = nfdTierColour(owned.tier ?? 0, best);
  return (
    <div
      className={"nfd-card" + (owned.tier == null ? " sealed" : "")}
      style={{ ["--nfd" as string]: colour, ["--nfd-aspect" as string]: cssAspect(collection.aspectRatio) }}
      title={item?.name ?? (owned.revealPending ? "opening" : "sealed pack")}
    >
      {art ? <img src={art} alt="" /> : <span className="nfd-noart">no art</span>}
      <span className="nfd-card-tier">
        {owned.tier == null ? (owned.revealPending ? "OPENING" : "SEALED") : `T${owned.tier}`}
      </span>
      {owned.ultraRare != null && <span className="nfd-card-ur">UR{owned.ultraRare}</span>}
    </div>
  );
}
