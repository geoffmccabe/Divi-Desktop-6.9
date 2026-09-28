// A one-shot handoff, like sendTarget.ts, so a wallet's "Get HRA" button can
// open the Names tab with the address the name should pay to. Shell switches
// to the hra view on dd69:gethra; NameRegister takes() the target and keeps
// it beside the reservation (localStorage) so the twelve-minute wait and a
// restart do not lose it. Once the name is registered, the wallet points the
// name's Divi-address record at that address; the node's wallet stays the
// owner so it can renew, manage and sell the name.

export interface HraTarget { address: string; label: string }

let pending: HraTarget | null = null;

export function setHraTarget(address: string, label = "") {
  pending = { address, label };
  window.dispatchEvent(new CustomEvent("dd69:gethra"));
}

export function takeHraTarget(): HraTarget | null {
  const t = pending;
  pending = null;
  return t;
}

export function peekHraTarget(): HraTarget | null {
  return pending;
}

const KEY = "dd69.hraPointings";

/** Names waiting to be pointed at a wallet address once registered. */
export function loadPointings(): Record<string, HraTarget> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, HraTarget>;
  } catch {
    return {};
  }
}

export function savePointing(name: string, target: HraTarget | null) {
  const all = loadPointings();
  if (target) all[name] = target;
  else delete all[name];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* per-viewer convenience only */
  }
}

/**
 * Point every registered name that has a stored target at its wallet
 * address. Cheap when nothing is stored. Retried by whoever calls it (the
 * header's light poll, always mounted) until each one goes through; an
 * entry is dropped only on success. Names still in `skip` (unregistered
 * reservations) are left alone.
 */
export async function settlePointings(skip: string[] = []): Promise<void> {
  const all = loadPointings();
  const todo = Object.keys(all).filter((n) => !skip.includes(n));
  if (todo.length === 0) return;
  const { hraMyNames, hraSetDiviAddress } = await import("./hra/api");
  let mine: { name: string; diviAddress: string | null }[] = [];
  try {
    mine = await hraMyNames();
  } catch {
    return;
  }
  for (const n of todo) {
    const owned = mine.find((m) => m.name === n);
    if (!owned) continue;
    if (owned.diviAddress === all[n].address) {
      savePointing(n, null);
      continue;
    }
    try {
      await hraSetDiviAddress(n, all[n].address);
      savePointing(n, null);
    } catch {
      /* not confirmed yet or the node is busy; next time */
    }
  }
}
