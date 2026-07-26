// Contacts (the Address Book): people, services, and your own other wallets you
// send to, so you pick a name instead of pasting an address. Local for now; the
// shape here is what gets pushed to Supabase per-account once LW-SSO auth is
// wired (mirrors the addressNames.ts plan). Labels never touch the blockchain.

const KEY = "dd69.contacts";

export type ContactType = "person" | "service" | "wallet";

export interface ContactAddress {
  address: string;
  label?: string; // e.g. "cold", "tips"; an optional per-address note
}

export interface Contact {
  id: string;
  name: string;
  type: ContactType;
  addresses: ContactAddress[]; // first entry is the primary
  note?: string;
  emoji?: string; // optional avatar override; identicon is the default
  favorite?: boolean;
  sentCount?: number; // times we've broadcast a send to any of its addresses
  lastSentAt?: number; // ms
  createdAt: number;
}

export const TYPE_LABEL: Record<ContactType, string> = {
  person: "Person",
  service: "Service",
  wallet: "My Wallet",
};

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "c" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function loadContacts(): Contact[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list: Contact[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

// Favorites first, then most-recently-used, then alphabetical: the order the
// list and the Send picker both show.
export function sortedContacts(list = loadContacts()): Contact[] {
  return [...list].sort((a, b) => {
    if (!!b.favorite !== !!a.favorite) return a.favorite ? -1 : 1;
    const la = a.lastSentAt ?? 0;
    const lb = b.lastSentAt ?? 0;
    if (lb !== la) return lb - la;
    return a.name.localeCompare(b.name);
  });
}

export function upsertContact(c: Omit<Contact, "id" | "createdAt"> & { id?: string }): Contact[] {
  const list = loadContacts();
  if (c.id) {
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = { ...list[i], ...c, id: c.id } as Contact;
  } else {
    list.push({ ...c, id: newId(), createdAt: Date.now() });
  }
  save(list);
  return list;
}

export function removeContact(id: string): Contact[] {
  const list = loadContacts().filter((c) => c.id !== id);
  save(list);
  return list;
}

export function toggleFavorite(id: string): Contact[] {
  const list = loadContacts();
  const c = list.find((x) => x.id === id);
  if (c) c.favorite = !c.favorite;
  save(list);
  return list;
}

// Find the contact (and the specific matched address) that owns an address.
export function findByAddress(address: string): { contact: Contact; matched: ContactAddress } | null {
  const a = address.trim();
  if (!a) return null;
  for (const c of loadContacts()) {
    const matched = c.addresses.find((x) => x.address === a);
    if (matched) return { contact: c, matched };
  }
  return null;
}

// True once we've successfully broadcast at least one send to this address,
// used to fade the "first time sending here" warning after it's proven good.
export function isKnownGood(address: string): boolean {
  const hit = findByAddress(address);
  return !!hit && (hit.contact.sentCount ?? 0) > 0;
}

// Record a confirmed broadcast to an address, so the contact turns known-good.
export function markSent(address: string): void {
  const list = loadContacts();
  const a = address.trim();
  const c = list.find((x) => x.addresses.some((y) => y.address === a));
  if (!c) return;
  c.sentCount = (c.sentCount ?? 0) + 1;
  c.lastSentAt = Date.now();
  save(list);
}
