// Classifying a node by the client software it advertises (its subversion /
// user-agent string, from getpeerinfo). One table, evaluated top-to-bottom, with
// an "unknown" fallback — adding a future client type is a single row.
//
// Honesty: this reflects what a node CLAIMS to run (a node can spoof its
// user-agent). Fine for a friendly network map; not proof of anything.
//
// Lovenodes are NOT here — they never join the peer network (they talk to a
// relay), so no subver ever identifies one. They come from the relay feed and
// are drawn separately (a heart). See docs/NODE-TYPES-SCOPE.md.

export type NodeMarker = "dot" | "square" | "heart" | "unknown";

export interface NodeType {
  id: string;
  label: string; // shown in the hover tooltip
  marker: NodeMarker;
  /** null = keep the map's default look (current purple/blue). A colour string
   *  overrides it for a genuinely distinct client. */
  color: string | null;
}

const OLD_CORE: NodeType = { id: "old-core", label: "Divi Core (original)", marker: "dot", color: null };
const DD69_CORE: NodeType = { id: "dd69-core", label: "DD69 Core", marker: "dot", color: null };
const BOX_WALLET: NodeType = { id: "box-wallet", label: "Box Wallet", marker: "square", color: "hsl(48 95% 60%)" };
const UNKNOWN: NodeType = { id: "unknown", label: "Unknown client", marker: "unknown", color: "hsl(0 0% 60%)" };
export const LOVENODE: NodeType = { id: "lovenode", label: "Lovenode", marker: "heart", color: "hsl(330 85% 65%)" };

// Rules in priority order. `test` runs against the lower-cased subver string.
// NOTE: today every node on the live network reports exactly
// "DIVI Core: 3.0.0.0", so in practice everything classifies as OLD_CORE until
// (a) the chain ships the -dd69 subver tag and (b) Box Wallet's string is known.
const RULES: { test: (sv: string) => boolean; type: NodeType }[] = [
  { test: (sv) => sv.includes("dd69"), type: DD69_CORE },
  // Box Wallet's exact user-agent is TBD (ask the author). Placeholder match.
  { test: (sv) => sv.includes("box"), type: BOX_WALLET },
  { test: (sv) => sv.includes("divi core"), type: OLD_CORE }, // plain 3.0.0.0
];

/** Classify a node from its advertised subversion string. */
export function classifyNode(subver?: string): NodeType {
  const sv = (subver || "").toLowerCase().trim();
  if (!sv) return UNKNOWN;
  for (const r of RULES) if (r.test(sv)) return r.type;
  return UNKNOWN;
}
