// The inventory: what this account owns. Opened with I.
//
// Four parts, top to bottom: the ships in the fleet, the guns and gear bought
// for them, the SEALED spheres picked up in the fight, and the items opened
// out of them. Items and spheres are sorted best tier first, then by name.
// Every sphere and item is a card: the sphere turning in 3D on the left, its
// tier, name and what it does on the right. Right-click a sealed sphere to
// open it (Geoff, 2026-Sep-11). A marketplace for unopened spheres comes
// later; this is why they are kept sealed rather than opened on pickup.
//
// Right-click an opened UPGRADE (a strafe, a hull boost, a rear gun) and it asks
// "Apply to Ship? (y/n)": yes fits it to the ship being flown for good, using the
// item up (Geoff, 2026-Sep-13). Until then it does nothing; see shipFleet.ts.

import { useEffect, useRef, useState } from "react";
import { ITEMS, ITEM_TIER_NAMES, FORGE_COST, itemByKey, itemMark, itemTierColour, forgeable, type ItemSpec } from "./itemCatalog";
import { forge } from "./rebelsForge";
import { heldSorted, spheresSorted, openSphere } from "./rebelsInventory";
import { owned, subscribeArmoury } from "./rebelsArmoury";
import { weaponByKey } from "./weaponCatalog";
import { myFleet, saveFlyingShip, type FleetShip } from "./rebelsShips";
import { applyToShip, isShipUpgrade, shipName, shipUpgrades } from "./shipFleet";
import { platform } from "./platform/current";
import { shipCatalog } from "./shipCatalog";
import { loadShip } from "./shipChoice";
import { showSphere } from "./sphereCards";

export function InventoryPanel({ onClose }: { onClose: () => void }) {
  const [, bump] = useState(0);
  const [fleet, setFleet] = useState<FleetShip[] | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => subscribeArmoury(() => bump((n) => n + 1)), []);
  useEffect(() => {
    let alive = true;
    void myFleet().then((f) => { if (alive) setFleet(f); }).catch(() => { if (alive) setFleet([]); });
    return () => { alive = false; };
  }, []);

  const spheres = spheresSorted();
  const items = heldSorted();
  const mine = owned();
  const guns = mine.map((k) => weaponByKey(k)).filter((w): w is NonNullable<typeof w> => !!w).sort((a, b) => a.slot - b.slot);
  const gear = mine.map((k) => itemByKey(k)).filter((i): i is ItemSpec => !!i && !i.drop);
  const flying = loadShip();
  const catalogue = shipCatalog();

  const open = (key: string) => {
    const spec = itemByKey(key);
    if (openSphere(key)) setNote(`OPENED: ${spec?.name ?? key}`);
  };

  /* ---- fitting an upgrade to the ship ---- */
  const limits = platform().limits;
  const [fitting, setFitting] = useState<string | null>(null);
  const flyingName = shipName(flying) || catalogue.find((c) => c.id === flying)?.name || flying;
  const startFit = (key: string) => {
    if (!isShipUpgrade(key)) return;
    if (!limits.customiseShips) { setNote(limits.why); return; }
    setFitting(key);
  };
  const answerFit = (yes: boolean) => {
    const key = fitting;
    setFitting(null);
    if (!key || !yes) return;
    const r = applyToShip(flying, key);
    if (r.ok) {
      setNote(`FITTED: ${itemByKey(key)?.name ?? key} to ${flyingName}`);
      void saveFlyingShip(flying);
    } else {
      setNote(`NOT FITTED: ${r.why}`);
    }
  };
  /* Y and N answer the question. Caught before the game's own keys (Y is also
     "use a recharge", and Escape would leave the game), so the answer is only an
     answer. */
  useEffect(() => {
    if (!fitting) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "y" || k === "enter") { e.preventDefault(); e.stopPropagation(); answerFit(true); }
      else if (k === "n" || k === "escape") { e.preventDefault(); e.stopPropagation(); answerFit(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitting]);
  const [forging, setForging] = useState<string | null>(null);
  const doForge = async (key: string) => {
    if (forging) return;
    setForging(key);
    setNote(`FORGING ${FORGE_COST} x ${itemByKey(key)?.name ?? key}`);
    const r = await forge(key);
    setForging(null);
    setNote(r.ok ? `FORGED: ${itemByKey(r.result)?.name ?? r.result}` : `FORGE REFUSED: ${r.why}`);
  };

  return (
    <>
      <div className="orbit-inv-scrim" onClick={onClose} />
      <div className="orbit-inv">
        <div className="orbit-inv-head">
          <h3>INVENTORY</h3>
          <span className="orbit-inv-note">{note || "Right-click a sealed sphere to open it."}</span>
          <button type="button" onClick={onClose}>CLOSE</button>
        </div>
        <div className="orbit-inv-body">
          <section>
            <h4>SHIPS</h4>
            <div className="orbit-inv-rows">
              {fleet === null && <span className="orbit-inv-dim">reading your fleet</span>}
              {fleet && (() => {
                /* The ship being flown is always listed, named and fitted as this
                   device has it, even before the account has a row for it. */
                const models = [flying, ...fleet.map((s) => s.model).filter((m) => m !== flying)];
                return models.map((model) => {
                  const row = fleet.find((s) => s.model === model);
                  const cls = catalogue.find((c) => c.id === model) ?? null;
                  const name = shipName(model) || row?.name || cls?.name || model;
                  const fittedNames = shipUpgrades(model).map((k) => itemByKey(k)?.name ?? k);
                  return (
                    <div key={model} className={"orbit-inv-row" + (model === flying ? " on" : "")}>
                      <b>{name}</b>
                      <em>
                        {cls ? `${cls.name} · tier ${cls.tier}` : `tier ${row?.tier ?? 1}`}{model === flying ? "  FLYING" : ""}
                        {fittedNames.length ? ` · fitted: ${fittedNames.join(", ")}` : ""}
                      </em>
                    </div>
                  );
                });
              })()}
            </div>
          </section>

          <section>
            <h4>GUNS AND GEAR</h4>
            <div className="orbit-inv-rows">
              {guns.map((w) => (
                <div key={w.key} className="orbit-inv-row"><b>{w.slot}  {w.name}</b><em>{w.note}</em></div>
              ))}
              {gear.map((g) => (
                <div key={g.key} className="orbit-inv-row"><b>{g.name}</b><em>{g.note}</em></div>
              ))}
              {guns.length + gear.length === 0 && <span className="orbit-inv-dim">Nothing bought yet.</span>}
            </div>
          </section>

          <section>
            <h4>SEALED SPHERES <span>{spheres.reduce((n, s) => n + s.count, 0)}</span></h4>
            {spheres.length === 0 && <span className="orbit-inv-dim">None. A wreck sometimes leaves one; fly through it.</span>}
            <div className="orbit-inv-cards">
              {spheres.map((s) => {
                const spec = itemByKey(s.key)!;
                return (
                  <SphereCard key={s.key} tier={spec.tier} count={s.count} sealed oval={spec.kind === "egg"}
                    title={spec.kind === "egg" ? "DRAGON EGG" : `TIER ${spec.tier} SPHERE`}
                    text={`${ITEM_TIER_NAMES[spec.tier - 1]} tier. Sealed. Right-click to open, or keep it to sell.`}
                    onOpen={() => open(s.key)} />
                );
              })}
            </div>
          </section>

          <section>
            <h4>ITEMS <span>{items.reduce((n, s) => n + s.count, 0)}</span></h4>
            {items.length === 0 && <span className="orbit-inv-dim">Nothing opened yet.</span>}
            <div className="orbit-inv-cards">
              {items.map((s) => {
                const spec = itemByKey(s.key)!;
                const canForge = forgeable(spec) && s.count >= FORGE_COST;
                return (
                  <SphereCard key={s.key} tier={spec.tier} count={s.count} label={`T${spec.tier} ${itemMark(spec)}`} oval={spec.kind === "egg"}
                    title={spec.name}
                    text={spec.consumable
                      ? `${spec.note} Press Y in flight to use one.`
                      : isShipUpgrade(s.key)
                        ? `${spec.note} Right-click to fit it to your ship for good.`
                        : spec.note}
                    onOpen={isShipUpgrade(s.key) ? () => startFit(s.key) : undefined}
                    action={canForge ? {
                      label: forging === s.key ? "FORGING" : `FORGE ${FORGE_COST} INTO 1`,
                      hint: "90% next tier, 9% two up, 1% three up",
                      run: () => void doForge(s.key),
                    } : undefined} />
                );
              })}
            </div>
          </section>

          <p className="orbit-inv-foot">
            {ITEMS.length} things sold in the store; everything else is found. Strafe, Hull and Rear Gun items work once fitted to a ship (right-click one), from your next launch; four of a kind can be forged into one of the next tier.
          </p>
        </div>

        {fitting && (
          <div className="orbit-inv-confirm" role="dialog" aria-label="Apply to Ship">
            <h4>Apply to Ship? (y/n)</h4>
            <p>
              <b>{itemByKey(fitting)?.name ?? fitting}</b> goes onto <b>{flyingName}</b> for good.
              The item is used up, and this ship keeps the benefit.
            </p>
            <div>
              <button type="button" onClick={() => answerFit(true)}>Y  APPLY</button>
              <button type="button" className="no" onClick={() => answerFit(false)}>N  KEEP IT</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SphereCard({ tier, count, label, title, text, sealed, onOpen, action, oval }: {
  tier: number; count: number; label?: string; title: string; text: string; sealed?: boolean; onOpen?: () => void;
  action?: { label: string; hint: string; run: () => void }; oval?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    return showSphere(c, { tier, label, oval });
  }, [tier, label, oval]);
  const colour = `#${itemTierColour(tier).toString(16).padStart(6, "0")}`;
  return (
    <div
      className={"orbit-inv-card" + (sealed ? " sealed" : "")}
      style={{ ["--tier" as string]: colour }}
      onContextMenu={(e) => { e.preventDefault(); onOpen?.(); }}
      title={sealed ? "Right-click to open" : undefined}
    >
      <canvas ref={ref} className="orbit-inv-ball" />
      <div className="orbit-inv-text">
        <span className="orbit-inv-tier">T{tier} {ITEM_TIER_NAMES[tier - 1].toUpperCase()}</span>
        <b>{title}</b>
        <em>{text}</em>
        {action && (
          <span className="orbit-inv-action">
            <button type="button" onClick={action.run}>{action.label}</button>
            <i>{action.hint}</i>
          </span>
        )}
      </div>
      {count > 1 && <span className="orbit-inv-count">x{count}</span>}
    </div>
  );
}
