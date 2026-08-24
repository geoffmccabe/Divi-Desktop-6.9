import { useCallback, useEffect, useState } from "react";
import { walletAddresses } from "../wallet/api";
import { PurchaseWithDivi, type PurchaseOption, type PurchaseProgress } from "./PurchaseWithDivi";
import { accountState, catalogue, claimOrder, startOrder, type Catalogue, type Tier } from "./api";
import "./points.css";

// Points: the balance chip, and the two ways to buy more.
//
// Points are what the App Builder spends. They are bought with DIVI up front,
// which is what makes the whole thing safe to run: the balance is held by the
// service and can only be increased by a payment the Divi node has actually
// seen. Nothing in the wallet can add to it.
//
// The bundles come from the service, priced there. This file never works out a
// price, so a discount can be changed in one place and cannot drift.

/**
 * Which account the points belong to.
 *
 * The wallet's main receiving address, because it is stable, already unique to
 * this person, and is the same thing a signed login will use when that lands.
 * Until then it is taken at its word, which is only acceptable because the
 * service listens on this machine and nowhere else.
 */
export async function pointsAccount(): Promise<string> {
  try {
    const list = await walletAddresses();
    const main = list.find((a) => a.isMain) ?? list[0];
    return main?.address ?? "local";
  } catch {
    return "local";
  }
}

function toOption(t: Tier): PurchaseOption {
  const listDivi = t.discountPercent > 0 ? t.divi / (1 - t.discountPercent / 100) : undefined;
  return {
    id: t.id,
    name: t.name,
    headline: `${t.points.toLocaleString()} points`,
    detail: t.blurb,
    amountDivi: t.divi,
    wasDivi: listDivi,
    badge: t.discountPercent > 0 ? `${t.discountPercent}% off` : undefined,
    best: t.discountPercent >= 30,
  };
}

/**
 * The purchase flow. Rendered by whichever button opened it.
 *
 * The modal knows nothing about points: it is handed choices and told when the
 * money moved, so the same window will sell anything else later.
 */
export function BuyPointsFlow({ onClose, onBought }: { onClose: () => void; onBought?: () => void }) {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    catalogue()
      .then(setCat)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const prepare = useCallback(async (option: PurchaseOption) => {
    const account = await pointsAccount();
    const order = await startOrder(account, option.id);
    setOrderId(order.id);
    // The amount carries a tiny marker unique to this order, so the payment
    // identifies itself and cannot be claimed by anyone else.
    return { address: order.address, amountDivi: order.amountDivi };
  }, []);

  const sent = useCallback(
    async (_option: PurchaseOption, txid: string): Promise<PurchaseProgress> => {
      if (!orderId) return { done: false, note: "Waiting for the network to confirm it." };
      const order = await claimOrder(orderId, txid);
      if (order.state === "paid") {
        onBought?.();
        return { done: true, note: `${order.points.toLocaleString()} points added to your balance.` };
      }
      return {
        done: false,
        note: `Confirmed ${order.confirmations} of ${order.needsConfirmations} times. Points appear when it settles.`,
      };
    },
    [orderId, onBought],
  );

  if (err) {
    return (
      <PurchaseWithDivi
        options={[]}
        onPrepare={async () => ({ address: "", amountDivi: 0 })}
        onSent={async () => ({ done: true, note: "" })}
        onClose={onClose}
        unavailable={`The builder service is not answering, so points cannot be bought. ${err}`}
      />
    );
  }

  if (!cat) return null;

  return (
    <PurchaseWithDivi
      options={cat.tiers.map(toOption)}
      onPrepare={prepare}
      onSent={sent}
      onClose={onClose}
      unavailable={cat.available ? null : cat.why}
      footnote={
        cat.available
          ? `Points pay for the AI that writes your app. ${cat.pointsPerUsd.toLocaleString()} points is one dollar of build time.`
          : undefined
      }
    />
  );
}

/** The balance, with a button to top it up. */
export function PointsChip({ compact = false }: { compact?: boolean }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);

  const refresh = useCallback(() => {
    pointsAccount()
      .then(accountState)
      .then((a) => setBalance(a.balancePoints))
      .catch(() => setBalance(null));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <>
      <span className="pts-chip">
        <span className={`pts-value${balance !== null && balance < 200 ? " pts-low" : ""}`}>
          {balance === null ? "—" : balance.toLocaleString()}
        </span>
        {!compact && <span className="pts-label">points</span>}
        <button type="button" className="wl-btn pts-buy" onClick={() => setBuying(true)}>
          Buy
        </button>
      </span>
      {buying && (
        <BuyPointsFlow
          onClose={() => {
            setBuying(false);
            refresh();
          }}
          onBought={refresh}
        />
      )}
    </>
  );
}

/** A plain button, for anywhere that is not showing a balance. */
export function BuyPointsButton({ label = "Buy points", onBought }: { label?: string; onBought?: () => void }) {
  const [buying, setBuying] = useState(false);
  return (
    <>
      <button type="button" className="wl-btn wl-btn-primary" onClick={() => setBuying(true)}>
        {label}
      </button>
      {buying && <BuyPointsFlow onClose={() => setBuying(false)} onBought={onBought} />}
    </>
  );
}
