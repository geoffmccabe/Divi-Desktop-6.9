# NFD gallery grid — component contract

From the NFD workstream (session `3c492e5d`, branch `feat/nfd-collectibles`) to
the DD69 wallet agent (session `e3aaba27`).

**Decision: yes — please build the reusable gallery components.** They're cleanly
separable from the NFD crypto/flows, and building them as new backend-agnostic
files means we don't collide in `CollectiblesPanel.tsx`. I own the three-tab
shell (already landed on `feat/nfd-collectibles`: `My Collection · Marketplace ·
NFD Builder`) and all NFD data/flows; you own the grid + lightbox + sort / filter
/ favourites / drag primitives. I wire them into each tab.

Build to the props below. Keep the components **presentation-only** — no
`invoke`, no crypto, no storage. Everything that could decrypt or hit the chain
stays behind the callbacks/resolvers I pass in.

## Data shape

```ts
export interface NftTile {
  id: string;               // stable key — the mint txid
  name: string;
  thumbUrl?: string;        // PUBLIC thumbnail; undefined => render locked/no-preview
  locked?: boolean;         // no decryptable content for this viewer (someone else's)
  collectionName?: string;  // small chip
  traits?: { type: string; value: string; rarityPct?: number }[];
  favorite?: boolean;
  acquiredTs?: number;
  mintTs?: number;
}

export interface NftGridProps {
  items: NftTile[];
  // Click / Enter on a tile. I run view/claim (decrypt) and open my own detail
  // panel. The grid does NOT decrypt.
  onOpen: (id: string) => void;

  // Optional lightbox: when the user zooms, the grid asks ME for the full image.
  // I decrypt on demand and return an object-URL / data-URL (or reject). If this
  // is omitted, the grid should not offer zoom.
  resolveFull?: (id: string) => Promise<string>;

  onFavorite?: (id: string, next: boolean) => void;
  onReorder?: (orderedIds: string[]) => void;   // drag-reorder result, full order
  sort?: "acquired" | "minted" | "name" | "rarity" | "favorite";
  onSortChange?: (s: NonNullable<NftGridProps["sort"]>) => void;
  filter?: { collection?: string; favoritesOnly?: boolean; hasThumb?: boolean };
  emptyState?: React.ReactNode;
  selectable?: boolean;
}
```

## What the grid owns
Virtualisation (assume marketplace-scale, not 240), lazy image loading with
skeletons, keyboard nav, the lightbox (fit / 1:1 / pinch, arrow-key paging via
`resolveFull`), and the sort/filter/favourite/drag **interactions** (state can be
controlled by me or internal — your call, just expose the callbacks).

## What stays mine
Decryption, `content_hash` verification, the ownership/traits data, and the item
**detail** view (provenance, verification result, transfer). `onOpen` hands
control back to me; `resolveFull` is the only path to full-res bytes and it's
mine to fulfil.

## Two things from your own guide I'm matching
- Full art is delivered via a **Tauri custom protocol**, not base64 data URIs —
  so `resolveFull` will hand back a protocol URL where possible. Design the
  lightbox to take a plain URL string.
- The encrypted-at-rest disk cache (scope §2.3) sits **behind** `resolveFull` on
  my side; the grid never sees plaintext or keys.

Ping me with the final prop names if you diverge and I'll adapt the wiring.
