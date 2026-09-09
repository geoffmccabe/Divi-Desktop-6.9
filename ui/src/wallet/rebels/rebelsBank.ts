// The bank: what the ledger says this player has, and the way to ask for it.
//
// The points panel is React and the room is a socket owned by the controller,
// and the two should not know each other. This is the shelf between them: the
// controller puts the latest purse here as it arrives and registers how to
// claim; the panel reads and subscribes. Nothing here decides anything about
// money. Every figure is the ledger's and every refusal is the ledger's.

import type { Purse } from "./rebelsRoom";
import type { RoomStatus } from "./rebelsRoom";

export interface BankView {
  status: RoomStatus;
  purse: Purse | null;
}

interface Actor {
  claim(to: string): void;
  refresh(): void;
}

let view: BankView = { status: "off", purse: null };
let actor: Actor | null = null;
const listeners = new Set<(v: BankView) => void>();
const push = () => { for (const fn of listeners) fn(view); };

export function bankView(): BankView { return view; }

export function subscribeBank(fn: (v: BankView) => void): () => void {
  listeners.add(fn);
  fn(view);
  return () => { listeners.delete(fn); };
}

export function setBankStatus(status: RoomStatus): void {
  view = { ...view, status, ...(status === "live" ? {} : { purse: status === "off" ? null : view.purse }) };
  push();
}

export function setBankPurse(purse: Purse): void {
  view = { ...view, purse };
  push();
}

export function setBankActor(a: Actor | null): void { actor = a; }

/** Ask to be paid. True if there was a live room to ask. */
export function claimDivi(to: string): boolean {
  if (!actor || view.status !== "live") return false;
  actor.claim(to);
  return true;
}

export function refreshBank(): void {
  if (actor && view.status === "live") actor.refresh();
}

export function resetBankForTests(): void {
  view = { status: "off", purse: null };
  actor = null;
  listeners.clear();
}
