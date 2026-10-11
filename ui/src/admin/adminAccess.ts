// Who may see the admin panels on a public page.
//
// THE PROBLEM THIS SOLVES. In the desktop app the gear is simply there: the app
// is one person's own wallet, and a panel they cannot use is only a panel they
// cannot use. divi.love/rebels is a public page, and an admin tab in front of a
// player is wrong even if every button on it would be refused. So the web asks
// the server one question, "does this credential belong to an admin", and shows
// the door only if the answer comes back yes.
//
// THE ANSWER COMES FROM THE SERVER, NEVER FROM HERE. The question is answered
// by public.rebels_role (supabase/migrations/20261011120000_rebels_admin_role.sql),
// which checks the same admin row the save functions check. Nothing in this
// file decides anything: it asks, it remembers the answer, and it forgets it
// again when the answer changes. A page cannot grant itself a role by editing
// its own storage, because every write is still presented to the save functions
// and refused on its own merits.
//
// WHAT IS REMEMBERED, AND WHY THAT IS SAFE. The ROLE is remembered (so the gear
// is there on the next visit without asking again), and it is re-asked on every
// load where a secret exists. Changing the admin secret therefore takes the
// gear away from every browser that had it, on their next visit, without
// anybody having to clear anything. The secret itself is kept where the four
// panels already keep it, under one key, so it is typed once.

/** The roles LW-SSO already issues per account: user, admin, superadmin. The
 *  two privileged ones are the two that open the door. */
export type AdminRole = "admin" | "superadmin";

/** Where all four Rebels panels keep the admin secret. One place to type it. */
export const ADMIN_SECRET_KEY = "dd69.admin.rebelsDropsSecret";
/** The remembered answer, so the gear survives a reload. */
const ROLE_KEY = "dd69.admin.role";
/** How long a remembered answer stands without being re-asked. It is re-asked
 *  on every load anyway when a secret is present; this only bounds the case of
 *  a browser that is offline, or a database that is unreachable, so an old yes
 *  cannot stand for ever. */
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

const PRIVILEGED = new Set<string>(["admin", "superadmin"]);

/** A role, or null for anything that is not one. Accepts the shapes PostgREST
 *  can hand back for a function returning text: the bare string, a one-element
 *  array, or an object with a role in it. */
export function roleFrom(raw: unknown): AdminRole | null {
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return PRIVILEGED.has(v) ? (v as AdminRole) : null;
  }
  if (Array.isArray(raw)) return raw.length === 1 ? roleFrom(raw[0]) : null;
  if (raw && typeof raw === "object") return roleFrom((raw as { role?: unknown }).role);
  return null;
}

type Kv = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Kv | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** The admin secret as last typed, or empty. Never sent anywhere but the
 *  database functions that check it. */
export function readSecret(kv: Kv | null = store()): string {
  try { return kv?.getItem(ADMIN_SECRET_KEY) ?? ""; } catch { return ""; }
}

/** Keep the secret, so it is typed once rather than once per panel. */
export function writeSecret(secret: string, kv: Kv | null = store()): void {
  try { kv?.setItem(ADMIN_SECRET_KEY, secret); } catch { /* private window: fine */ }
}

/** Remember that the server said yes. */
export function rememberRole(role: AdminRole, now = Date.now(), kv: Kv | null = store()): void {
  try { kv?.setItem(ROLE_KEY, JSON.stringify({ role, until: now + REMEMBER_MS })); } catch { /* fine */ }
}

/** Forget it: a wrong secret now, or an admin who asked to be let out. */
export function forgetRole(kv: Kv | null = store()): void {
  try { kv?.removeItem(ROLE_KEY); } catch { /* fine */ }
}

/** The remembered answer, if it has not run out. Unreadable or expired is null,
 *  which means no door, which is the safe direction. */
export function rememberedRole(now = Date.now(), kv: Kv | null = store()): AdminRole | null {
  let raw: string | null = null;
  try { raw = kv?.getItem(ROLE_KEY) ?? null; } catch { return null; }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { role?: unknown; until?: unknown };
    if (typeof v.until !== "number" || v.until < now) return null;
    return roleFrom(v.role);
  } catch {
    return null;
  }
}

/** How this file reaches the database: the same one line the game uses. */
export type RoleCaller = (fn: string, args: Record<string, unknown>) => Promise<Response>;

/**
 * Ask the server. Never throws: anything that is not a clear yes is a no, so a
 * database that cannot be reached closes the door rather than opening it.
 */
export async function askRole(secret: string, call: RoleCaller): Promise<AdminRole | null> {
  if (!secret.trim()) return null;
  try {
    const res = await call("rebels_role", { p_secret: secret.trim() });
    if (!res.ok) return null;
    return roleFrom(await res.json());
  } catch {
    return null;
  }
}

/**
 * The whole of what a page needs: ask, then remember or forget.
 *
 * Called on load. With no secret stored it asks nothing and reports whatever
 * was remembered, so an admin who has not typed the secret in this browser yet
 * is not thrown out of a door they already opened; with a secret it asks, and
 * an answer of no takes the door away immediately.
 */
export async function checkRole(
  call: RoleCaller, now = Date.now(), kv: Kv | null = store(),
): Promise<AdminRole | null> {
  const secret = readSecret(kv);
  if (!secret.trim()) return rememberedRole(now, kv);
  const role = await askRole(secret, call);
  if (role) rememberRole(role, now, kv);
  else forgetRole(kv);
  return role;
}

/* ---- THE WAY IN ON A BROWSER THAT HAS NEVER BEEN HERE ----
   The server cannot recognise an admin who has not typed the secret in this
   browser yet, so there has to be one way to reach the panels that does not
   depend on being recognised: /rebels/?admin=1 shows the gear for that visit.
   It GRANTS NOTHING. Every panel behind it still refuses to save without the
   secret, which the database checks, exactly as in the app. /rebels/?admin=0
   gives the door up again on a shared machine. */

/** What the address bar is asking for: in for this visit, out for good, or
 *  nothing at all, which is the ordinary case for everybody. */
export type DoorAsk = "in" | "out" | null;

export function doorAsk(search: string): DoorAsk {
  let v: string | null = null;
  try { v = new URLSearchParams(search).get("admin"); } catch { return null; }
  if (v === null) return null;
  const s = v.trim().toLowerCase();
  if (s === "0" || s === "out" || s === "false") return "out";
  return "in";
}
