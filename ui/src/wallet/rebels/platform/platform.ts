// The contract between the game and the place it runs.
//
// ONE GAME, SEVERAL DOORS
// -----------------------
// Divi Rebels runs inside the desktop wallet today, at divi.love/rebels next,
// and on phones after that. The game itself (flying, combat, the globe, the
// cockpit screens, the room) is the same in all of them. What differs is a
// short list of questions only the place can answer: who the player is, what
// DIVI is worth, what the player's wallet can do. A DOOR answers them.
//
// The game asks its door through `platform()` (see current.ts) and never
// reaches into the wallet itself. scripts/check-rebels-boundary.mjs proves
// that by bundling the game and failing if any wallet or app-bridge file ends
// up inside it.
//
// Geoff, 2026-Sep-13: "Ideally it can be done in a way that takes as much from
// the current app version, if possible, with only a handful of different
// modules that are web specific."
//
// This file holds TYPES ONLY, so importing it costs nothing and can never pull
// a door's code into the game.

import type { ComponentType } from "react";

/** Who is playing. */
export interface RebelsIdentity {
  /**
   * The player's name as others see it. Today it is ALSO the key the player's
   * saved rows use (scores, ships, loadout, forge), so a door must keep
   * returning the same name for the same player or they lose their rows.
   */
  name(): string;
  /**
   * What the room is told when this player joins. `selfIp` is the tower the
   * globe marked as this player's own, or "" when there is none. `door` is
   * "web" for a player on divi.love/rebels, so the room keeps their account
   * apart from any app player on the same internet address; the app sends
   * none, exactly as before.
   */
  joinFields(selfIp: string): { node: string; name: string; door?: "web"; guest?: string };
  /**
   * The key this player's saved rows are filed under on the account (loadout,
   * ships, forge). The node's name in the app, exactly as before; a web guest's
   * private id on the web, so two guests who happen to share a pilot number
   * never share a loadout.
   */
  accountKey(): string;
}

/**
 * Where the game keeps a player's progress on this device: points, bought gear,
 * found items, the DIVI tally, scores, the ship, its paint, names and upgrades.
 * Synchronous, because the game reads these in the middle of frames. The app
 * keeps them in localStorage as it always has; the web keeps them in IndexedDB,
 * loaded into memory before the game starts and written back on every change.
 */
export interface RebelsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What this player may do with ships. A guest flies the first hull as it
 *  comes; signing up opens the rest. */
export interface RebelsLimits {
  /** Choose a hull, paint it, name it and fit upgrades to it. */
  customiseShips: boolean;
  /** Shown wherever a locked thing is tried. */
  why: string;
}

/** The DIVI price, in the shape the wallet's price feed already returns:
 *  lowercase currency code to the price of one DIVI. `usd` is the one the game
 *  reads. CoinMarketCap only, in every door. */
export interface RebelsPrices {
  prices: Record<string, number>;
}

/** One way to buy points, as the buy panel shows it. Same fields as the
 *  wallet's own purchase panel, declared here so the game never imports it. */
export interface PurchaseOption {
  id: string;
  name: string;
  headline: string;
  detail?: string;
  amountDivi: number;
  badge?: string;
  wasDivi?: number;
  best?: boolean;
}

export interface PurchaseProgress {
  done: boolean;
  note: string;
}

export interface PayWithDiviProps {
  options: PurchaseOption[];
  onPrepare: (option: PurchaseOption) => Promise<{ address: string; amountDivi: number }>;
  onSent: (option: PurchaseOption, txid: string) => Promise<PurchaseProgress>;
  onClose: () => void;
  unavailable?: string | null;
  footnote?: string;
}

/** What the player's wallet can do, where there is one. */
export interface RebelsMoney {
  /** Whether a DIVI address is real. False when this door cannot check. */
  validateAddress(address: string): Promise<boolean>;
  /** The player's own wallet addresses, main one flagged. Empty without a wallet. */
  ownAddresses(): Promise<Array<{ address: string; isMain: boolean }>>;
  /** The panel that sends DIVI to buy points, or null where this door cannot
   *  send DIVI. */
  PayWithDivi: ComponentType<PayWithDiviProps> | null;
}

/**
 * How much the globe draws. A PHONE SEAM: the app and the web use today's
 * numbers; a phone door can draw less without the game changing.
 */
export interface RebelsDetail {
  /** Links drawn from your node to its peers. */
  peerLinks: number;
  /** Links drawn across the wider network. */
  meshLinks: number;
  /** Pixel ratio while a game is flying. */
  pixelRatio: number;
}

/** The cockpit's own handlers, one per event it listens to. */
export interface CockpitHandlers {
  wheel: (e: WheelEvent) => void;
  pointerleave: (e: PointerEvent) => void;
  pointermove: (e: PointerEvent) => void;
  pointerdown: (e: PointerEvent) => void;
  contextmenu: (e: Event) => void;
  pointerup: (e: PointerEvent) => void;
  keydown: (e: KeyboardEvent) => void;
  keyup: (e: KeyboardEvent) => void;
  blur: () => void;
  focus: () => void;
  pointerlockchange: () => void;
}

/**
 * Where the player's hands come in. A PHONE SEAM: keyboard and mouse today
 * (desktopInput.ts); a phone door plugs touch in here instead.
 */
export interface RebelsInput {
  /** Start listening. Returns the function that stops listening. */
  attach(dom: HTMLCanvasElement, handlers: CockpitHandlers): () => void;
}

/** Everything a door answers. */
export interface RebelsPlatform {
  /** Which door this is, for the DFlow report and nothing else. */
  id: string;
  identity: RebelsIdentity;
  storage: RebelsStorage;
  limits: RebelsLimits;
  /** The multiplayer server's address. */
  roomBase: string;
  /** Whether this player's wallet just won a stake (it decks out their tower).
   *  Always false where there is no staking wallet. */
  wonStakeRecently(windowMs?: number): boolean;
  prices: { fetch(): Promise<RebelsPrices> };
  money: RebelsMoney;
  detail: RebelsDetail;
  input: RebelsInput;
}
