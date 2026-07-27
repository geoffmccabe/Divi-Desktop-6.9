// The permission catalogue for Community Apps.
//
// One entry per thing an app can ask for. The `label` is the exact sentence the
// user reads at install time: if a capability cannot be explained honestly in one
// line, it does not belong here.
//
// Contract and rationale: docs/COMMUNITY-APPS-MANIFEST.md
//
// Adding an entry here is the ONLY way to widen what apps can do. The broker
// refuses any method that is not in this table, so a typo or an invented method
// name fails closed rather than falling through to the wallet.

export type PermissionKey =
  | "balance.read"
  | "addresses.read"
  | "history.read"
  | "staking.read"
  | "collectibles.read"
  | "tokens.read"
  | "network.read"
  | "chain.read"
  | "storage"
  | "payment.request"
  | "network"
  | "clipboard.write"
  | "notify";

export interface PermissionDef {
  key: PermissionKey;
  /** Shown verbatim to the user when they install the app. */
  label: string;
  /** Longer plain-English detail, shown when they expand the row. */
  detail: string;
  /** Read permissions are low risk; capabilities can act on the user's behalf. */
  kind: "read" | "capability";
  /** Capabilities that always need an explicit confirmation, every single time. */
  alwaysConfirm?: boolean;
}

export const PERMISSIONS: PermissionDef[] = [
  {
    key: "balance.read",
    label: "See your DIVI balance",
    detail: "Spendable, staking, pending and immature totals. Not your addresses.",
    kind: "read",
  },
  {
    key: "addresses.read",
    label: "See your receiving addresses",
    detail: "Your own addresses and the labels you gave them. Never any private key.",
    kind: "read",
  },
  {
    key: "history.read",
    label: "See your transaction history",
    detail: "Amounts, dates, categories and confirmation counts.",
    kind: "read",
  },
  {
    key: "staking.read",
    label: "See your staking and lottery status",
    detail: "Whether you are staking, per-address stake counts, lottery timing and past wins.",
    kind: "read",
  },
  {
    key: "collectibles.read",
    label: "See the collectibles you own",
    detail: "Names, traits, tiers and thumbnails. Never the key that decrypts the artwork.",
    kind: "read",
  },
  {
    key: "tokens.read",
    label: "See your Divi Meta Token balances",
    detail: "Token balances and details. Limited until the token index is live.",
    kind: "read",
  },
  {
    key: "network.read",
    label: "See the Divi network map",
    detail: "Peer and node information the wallet already shows publicly.",
    kind: "read",
  },
  {
    key: "chain.read",
    label: "See recent blocks and chain status",
    detail: "Block height, recent blocks and whether the wallet is in sync.",
    kind: "read",
  },
  {
    key: "storage",
    label: "Save data for this app",
    detail: "A private store only this app can read. Other apps cannot see it.",
    kind: "capability",
  },
  {
    key: "payment.request",
    label: "Ask you to pay DIVI",
    detail:
      "The app can ask. Only you can approve, in a window the app cannot draw or click, and spending caps still apply.",
    kind: "capability",
    alwaysConfirm: true,
  },
  {
    key: "network",
    label: "Connect to the internet",
    detail: "Only the specific sites listed by the app, and every request is logged.",
    kind: "capability",
  },
  {
    key: "clipboard.write",
    label: "Copy things to your clipboard",
    detail: "Write only. The app can never read what is already on your clipboard.",
    kind: "capability",
  },
  {
    key: "notify",
    label: "Show you notifications",
    detail: "Messages inside the wallet only, limited in how often they can appear.",
    kind: "capability",
  },
];

const BY_KEY = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.key, p]));

export function permission(key: string): PermissionDef | undefined {
  return BY_KEY.get(key);
}

export function isPermissionKey(key: string): key is PermissionKey {
  return BY_KEY.has(key);
}

/** Capabilities first, since those are the ones worth reading carefully. */
export function sortForDisplay(keys: PermissionKey[]): PermissionDef[] {
  return keys
    .map((k) => BY_KEY.get(k))
    .filter((d): d is PermissionDef => !!d)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "capability" ? -1 : 1));
}
