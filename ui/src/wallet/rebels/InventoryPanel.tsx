// The inventory: what this account owns. Opened with I.
//
// Four parts, top to bottom: the ships in the fleet, the guns and gear bought
// for them, the SEALED spheres picked up in the fight, and the items opened
// out of them. Items and spheres are sorted best tier first, then by name.
// Every sphere and item is a card: the sphere turning in 3D on the left, its
// tier, name and what it does on the right. Right-click a sealed sphere to
// open it (Geoff, 2026-Sep-11). A marketplace for unopened spheres comes
// later; this is why they are kept sealed rather than opened on pickup.

import { useEffect, useRef, useState } from "react";
import { ITEMS, ITEM_TIER_NAMES, itemByKey, itemMark, itemTierColour, type ItemSpec } from "./itemCatalog";
import { heldSorted, spheresSorted, openSphere } from "./rebelsInventory";
import { owned, subscribeArmoury } from "./rebelsArmoury";
import { weaponByKey } from "./weaponCatalog";
import { myFleet, type FleetShip } from "./rebelsShips";
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
              {fleet && fleet.length === 0 && <span className="orbit-inv-dim">Only the default hull so far.</span>}
              {fleet && fleet.map((s) => {
                const cls = catalogue.find((c) => c.id === s.model) ?? null;
                return (
                  <div key={s.id} className={"orbit-inv-row" + (s.model === flying ? " on" : "")}>
                    <b>{s.name || cls?.name || s.model}</b>
                    <em>tier {s.tier}{cls ? ` ${cls.role}` : ""}{s.model === flying ? "  FLYING" : ""}</em>
                  </div>
                );
              })}
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
                  <SphereCard key={s.key} tier={spec.tier} count={s.count} sealed
                    title={`TIER ${spec.tier} SPHERE`}
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
                return (
                  <SphereCard key={s.key} tier={spec.tier} count={s.count} label={`T${spec.tier} ${itemMark(spec)}`}
                    title={spec.name} text={spec.note} />
                );
              })}
            </div>
          </section>

          <p className="orbit-inv-foot">
            {ITEMS.length} things sold in the store; everything else is found. Items do nothing yet: what each does arrives with the next build.
          </p>
        </div>
      </div>
    </>
  );
}

function SphereCard({ tier, count, label, title, text, sealed, onOpen }: {
  tier: number; count: number; label?: string; title: string; text: string; sealed?: boolean; onOpen?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    return showSphere(c, { tier, label });
  }, [tier, label]);
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
      </div>
      {count > 1 && <span className="orbit-inv-count">x{count}</span>}
    </div>
  );
}
