# Contacts (Address Book) - module + integration handoff

Audience: another Claude agent wiring Contacts into the Send flow (and later
into other features). This documents what is BUILT, the public API, how the
Send handoff works, and the roadmap. No consensus or node changes are involved;
this is entirely wallet-side (DD69 UI).

## Status

BUILT and committed (wallet-side, local storage):

- `ui/src/wallet/contacts.ts` - the store and all helpers.
- `ui/src/wallet/Identicon.tsx` - self-contained blockies-style avatar.
- `ui/src/wallet/AddressBook.tsx` - the Contacts view (list, search, cards, QR).
- `ui/src/wallet/ContactEditor.tsx` - add/edit form (validates addresses).
- `ui/src/wallet/ContactPicker.tsx` - compact "pick a contact" dropdown for Send.
- `ui/src/wallet/sendTarget.ts` - one-shot recipient handoff to Send.
- `ui/src/Shell.tsx` - listens for `dd69:sendto` and switches to the Send view.
- `ui/src/index.css` - `.cb-*`, `.cp-*`, `.send-contact*`, `.send-to-label`.

NOT committed on `main` yet (left to you): the actual Send-panel wiring in
`ui/src/wallet/SendPanel.tsx`. A complete, working reference version of that
wiring currently exists UNCOMMITTED in the working tree (it is tangled with the
in-flight Fast Send edits to the same file). You can adopt it as-is or redo it;
see "Integrating into Send" below for exactly what it does.

## Data model

Stored in `localStorage` under `dd69.contacts` as a JSON array. Shape is
intentionally the payload we will later push per-account to Supabase once
LW-SSO auth is wired (same plan as `addressNames.ts`). Labels never touch the
blockchain.

A `Contact` has: `id`, `name`, `type` (`"person" | "service" | "wallet"`),
`addresses` (array of `{ address, label? }`, first is primary), optional
`note`, optional `emoji` (avatar override; identicon is the default),
`favorite`, `sentCount`, `lastSentAt`, `createdAt`.

`ContactType` currently covers People, Services, and "My Wallet" (your own
other nodes). Agents and Bots are on the roadmap, not built.

## Public API (`contacts.ts`)

- `loadContacts(): Contact[]` - raw list.
- `sortedContacts(list?): Contact[]` - favorites first, then most-recently-sent,
  then alphabetical. Use this for any user-facing list (the panel and the picker
  both do).
- `upsertContact(partial): Contact[]` - create (no `id`) or update (with `id`);
  returns the new full list.
- `removeContact(id): Contact[]`, `toggleFavorite(id): Contact[]`.
- `findByAddress(address): { contact, matched } | null` - who owns an address.
- `isKnownGood(address): boolean` - true once we have recorded a successful send
  to that address (used to fade the first-send warning).
- `markSent(address): void` - call this AFTER a broadcast succeeds; it bumps
  `sentCount` / `lastSentAt` on the matching contact so it turns "known".
- `TYPE_LABEL: Record<ContactType, string>` - display names.

## Components

- `<AddressBook />` - the whole Contacts view. Self-contained; no props. Renders
  the toolbar (search + Add), the card list, the editor (inline), and the QR
  overlay. Each card's Send button calls `setSendTarget(primaryAddress, name)`.
- `<ContactPicker onPick={(address, name) => void} disabled? />` - a small
  "Contacts" dropdown button. Returns null when there are no contacts. Picks the
  contact's primary address.
- `<Identicon address={string} size={number} />` - deterministic avatar from an
  address. Pure SVG, no network, CSP-safe. Use it anywhere you show an address
  so a swapped address is visually obvious.
- `<ContactEditor contact? onDone={(list?) => void} />` - used inside AddressBook;
  you normally will not mount this directly.

## The Send handoff (already wired in Shell)

1. A Contacts card's Send button calls `setSendTarget(address, name)` from
   `sendTarget.ts`, which stashes the recipient and fires a `dd69:sendto` event.
2. `Shell.tsx` listens for `dd69:sendto` and switches the active view to `send`.
3. `SendPanel` should, on mount, call `takeSendTarget()` (one-shot; returns the
   recipient once then clears it) and also listen for `dd69:sendto` to handle the
   case where Send is already the active view.

Steps 1 and 2 are done. Step 3 is the piece you own.

## Integrating into Send (what the reference wiring does)

The uncommitted reference version of `SendPanel.tsx` does exactly this, and it is
the recommended integration:

- On mount: consume `takeSendTarget()` to prefill the address, and add a
  `dd69:sendto` listener that prefills + resets the stage to `"form"`.
- Compute `const contactHit = findByAddress(address)` and
  `const knownGood = isKnownGood(address)` on each render.
- In the To-address field label, render `<ContactPicker disabled={stage !== "form"}
  onPick={(addr) => setAddress(addr)} />`.
- Under the address input, when `contactHit` is set, show a small banner: the
  contact's emoji or `<Identicon address={contactHit.matched.address} size={20} />`,
  the contact name, and either "✓ known" (when `knownGood`) or a soft warning
  "first time sending here, verify the address".
- After a successful broadcast (right after you get the txid, for BOTH the normal
  and the Fast Send paths), call `markSent(address.trim())` so the contact turns
  known-good.

Styling classes are already in `index.css`: `.send-to-label` (the label row that
holds the picker), `.send-contact` / `.send-contact-name` / `.send-contact-known`
/ `.send-contact-new` (the banner), and `.cp-*` (the picker dropdown).

Note on Fast Send: `markSent` should fire on the Fast Send path too, not only the
standard send, so a Fast Send to a contact still marks it known.

## Conventions to keep

- No em-dashes anywhere (UI text, comments, commits). Project rule.
- Match the existing DD69 panels; do not introduce a new visual language.
- Never add a raw-URL image input for avatars; emoji or upload/picker only.
- Address labels are local and advisory; the node is always the authority on
  address validity (we validate via `validateAddress`).

## Roadmap (not built)

Near-term, wallet-side:
- Contact "types" beyond the MVP: AI Agents (a side-wallet with a spend allowance
  and an activity log) and Bots (Telegram/Discord), each with its own icon/color.
- Request payment from a contact (there is already a payment-request tx type in
  `api.ts`: `paymentRequestCreate`).
- Per-contact activity: total sent, last sent, and their transactions filtered
  out of the main history.
- QR scan-to-add (desktop camera or image drop).

Backend-dependent (needs a directory/relay service and LW-SSO):
- Divi handle resolution: add a contact as a Telegram/Discord handle and resolve
  it to a payable address. SECURITY REQUIREMENT: the alias-to-address mapping must
  be server-signed with ownership proof, and the wallet must refuse to pay an
  unverified or newly-changed alias without a loud confirmation. We have already
  been bitten by the opposite (the SIEGEWORLDSLINK hijack, where a link accepted
  any username with no ownership proof and payments could be hijacked). Do not
  ship handle resolution without the signed-ownership guarantee.
- Cross-device sync: push the `dd69.contacts` payload per-account to Supabase once
  auth exists (the store shape is already sync-ready).

## Test notes

Contacts persist in `localStorage` (`dd69.contacts`). To test the Send handoff
between the two local nodes, add a "My Wallet" contact for each node's receive
address, then use a card's Send button; it should switch to Send with the
recipient prefilled and show the contact banner.
