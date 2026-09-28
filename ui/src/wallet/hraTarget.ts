// A one-shot handoff, like sendTarget.ts, so a wallet's "Get HRA" button can
// open the Names tab with the address the name should point at. Shell switches
// to the hra view on dd69:gethra; the register form takes() the address when
// it learns to point a name somewhere other than the node's main address
// (Phase 3 of docs/PARALLEL-WALLETS-PLAN.md).

let pending: string | null = null;

export function setHraTarget(address: string) {
  pending = address;
  window.dispatchEvent(new CustomEvent("dd69:gethra"));
}

export function takeHraTarget(): string | null {
  const t = pending;
  pending = null;
  return t;
}

export function peekHraTarget(): string | null {
  return pending;
}
