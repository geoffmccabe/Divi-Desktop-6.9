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

/** How the game reaches the account database (the Divi Desktop Supabase
 *  project). `bearer` is a signed-in player's credential when the door has one;
 *  without it the public key is used, as it always was. */
export interface RebelsAccountConnection {
  url: string;
  anonKey: string;
  bearer?: () => string | null;
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

/**
 * The PILOT: everything a pair of hands can ask of the ship, whatever the hands
 * are on. Keyboard and mouse drive it today (desktopInput.ts); touch will drive
 * the very same interface on a phone, without the game changing.
 */
export interface Pilot {
  /** What an input needs to know to read its device. */
  state(): {
    flying: boolean; hasFlight: boolean; panelOpen: boolean; locked: boolean; rearOn: boolean;
    /** Where the reticle is now, 0 to 1 across and down. */
    cursor: { x: number; y: number };
  };
  /** The held controls, each -1 to 1 or on and off. Only the ones given change.
   *  pitch/yaw are the keyboard's (the arrows); aiming is `moveCursor`. */
  setControls(c: Partial<{
    pitch: number; yaw: number; roll: number; strafe: number; lift: number; throttle: number;
    fullStop: boolean; boost: boolean; superBoost: boolean; guard: boolean;
  }>): void;
  /** Hold or release a trigger: the primary (left button, space) or the
   *  secondary (right button). */
  trigger(which: "primary" | "secondary", down: boolean): void;
  /** Put the reticle at this point of the frame, 0 to 1 across and down. The
   *  ship turns toward it and the mini gun fires at it. */
  moveCursor(x: number, y: number): void;
  /** The reticle back to the middle, and no turning (the pointer left). */
  centreCursor(): void;
  /** Everything let go (the window lost focus). */
  releaseAll(): void;
  /** Weapon `slot` 1 to 6. */
  selectWeapon(slot: number): void;
  /** The next weapon this ship owns (+1) or the one before (-1), wrapping round.
   *  For hands with no number keys: one button steps through the guns. */
  cycleWeapon(dir: 1 | -1): void;
  /** Use a held recharge or supercharge (Y). */
  useHeld(): void;
  /** Open or close the rear view (7). */
  toggleRear(): void;
  /** Cockpit or chase camera (V). */
  toggleView(): void;
  /** Zoom the chase camera one notch: +1 in, -1 out. */
  zoom(dir: number): void;
  /** Start the sound again from scratch (0). */
  restartSound(): void;
  /** A real user gesture happened: the moment a webview allows sound to wake. */
  gesture(): void;
  /** The window came back from somewhere else. */
  focusReturned(): void;
  /** The pointer lock changed hands. */
  lockChanged(): void;
  /** A key that may be part of a test cheat. True when it was, and must not also
   *  do its normal job. */
  cheatKey(key: string): boolean;
}

/**
 * Where the player's hands come in. A PHONE SEAM: keyboard and mouse today
 * (desktopInput.ts); a phone door plugs touch in here instead.
 */
export interface RebelsInput {
  /** Start listening, driving the pilot. Returns the function that stops. */
  attach(dom: HTMLCanvasElement, pilot: Pilot): () => void;
}

/** What the test cheats may ask of the game. Kept small on purpose: a cheat
 *  reaches the game only through these. */
export interface CheatHost {
  /** Whether a ship is in the air. Cheats do nothing on the launch card. */
  flying(): boolean;
  /** Ask the room to spawn something (the fight is the server's). */
  sendToRoom(code: string): void;
  addHeld(key: string, n: number): void;
  applyToShip(model: string, key: string): { ok: true } | { ok: false; why: string };
  grant(key: string): void;
  ship(): string;
  note(text: string): void;
}

/** The test cheats, as a door plugs them in. `onKey` returns true when the key
 *  was part of a cheat and must not also do its normal job. */
export interface RebelsCheats {
  onKey(key: string, now: number): boolean;
}

/** Everything a door answers. */
export interface RebelsPlatform {
  /** Which door this is, for the DFlow report and nothing else. */
  id: string;
  identity: RebelsIdentity;
  storage: RebelsStorage;
  limits: RebelsLimits;
  account: RebelsAccountConnection;
  /** The multiplayer server's address. */
  roomBase: string;
  /** Whether this player's wallet just won a stake (it decks out their tower).
   *  Always false where there is no staking wallet. */
  wonStakeRecently(windowMs?: number): boolean;
  prices: { fetch(): Promise<RebelsPrices> };
  money: RebelsMoney;
  detail: RebelsDetail;
  input: RebelsInput;
  /**
   * The test cheats (!11, !21, !77, !8t, !9t), or absent. A door that leaves this
   * out leaves the cheat code out of its build entirely: the web door does, so
   * the public page carries none. The room refuses cheats from web guests too.
   */
  cheats?: (host: CheatHost) => RebelsCheats;
}
