// Who may see the admin panels on a public page.
//
// Run: sh scripts/run-rebels-admin-tests.sh

import {
  roleFrom, askRole, checkRole, rememberRole, rememberedRole, forgetRole,
  readSecret, writeSecret, ADMIN_SECRET_KEY, doorAsk, type AdminRole,
} from "./adminAccess";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* A browser's storage, as much of it as this file uses. */
function fakeStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    all: () => Object.fromEntries(m),
  };
}

/* The database's answer, without a database. */
const answers = (role: unknown, opts: { ok?: boolean; throws?: boolean } = {}) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const call = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (opts.throws) throw new Error("no network");
    return new Response(JSON.stringify(role), { status: opts.ok === false ? 401 : 200 });
  };
  return { call, calls };
};

/* ---- reading the answer ---- */
{
  ok("superadmin is a role", roleFrom("superadmin") === "superadmin");
  ok("admin is a role", roleFrom("admin") === "admin");
  ok("a plain user is NOT", roleFrom("user") === null);
  ok("neither is nothing at all", roleFrom(null) === null);
  ok("nor an empty string", roleFrom("") === null);
  /* The one that matters: a refusal must never read as a yes. */
  ok("nor the word false", roleFrom("false") === null);
  ok("nor a stray true", roleFrom(true) === null);
  ok("case and spaces are forgiven", roleFrom("  SuperAdmin ") === "superadmin");
  ok("PostgREST's one-element array is read", roleFrom(["admin"]) === "admin");
  ok("an object with a role in it is read", roleFrom({ role: "superadmin" }) === "superadmin");
  ok("a longer array is not guessed at", roleFrom(["admin", "user"]) === null);
  ok("an unknown role is refused", roleFrom("moderator") === null);
}

/* ---- asking ---- */
{
  const a = answers("superadmin");
  const role = await askRole("  s3cret  ", a.call);
  ok("the server's yes is taken", role === "superadmin");
  ok("it asked rebels_role", a.calls[0]?.fn === "rebels_role");
  ok("and sent the secret trimmed", a.calls[0]?.args.p_secret === "s3cret");

  const b = answers("user");
  ok("a player's role opens nothing", (await askRole("x", b.call)) === null);

  const c = answers("superadmin", { ok: false });
  ok("a refused request is a no", (await askRole("x", c.call)) === null);

  const d = answers("superadmin", { throws: true });
  ok("so is a database that cannot be reached", (await askRole("x", d.call)) === null);

  const e = answers("superadmin");
  ok("an empty secret is not even asked about", (await askRole("   ", e.call)) === null);
  ok("and nothing was asked", e.calls.length === 0);
}

/* ---- remembering ---- */
{
  const kv = fakeStore();
  const now = 1_760_000_000_000;
  ok("nothing is remembered to start with", rememberedRole(now, kv) === null);
  rememberRole("superadmin", now, kv);
  ok("the answer is remembered", rememberedRole(now + 1000, kv) === "superadmin");
  ok("it is still there a week later", rememberedRole(now + 7 * 86_400_000, kv) === "superadmin");
  /* An old yes must not stand for ever: a browser that has been offline for a
     month asks again rather than keeping a door open. */
  ok("it has run out after 31 days", rememberedRole(now + 31 * 86_400_000, kv) === null);
  forgetRole(kv);
  ok("and it can be given up", rememberedRole(now + 1000, kv) === null);

  /* Storage is not a credential. Whatever is written there by hand, every save
     still goes to the database with the secret, so the worst a forged line can
     do is show somebody a panel that refuses them. */
  const forged = fakeStore({ "dd69.admin.role": JSON.stringify({ role: "superadmin", until: 9e15 }) });
  ok("a forged line does read as a role (and buys nothing)", rememberedRole(now, forged) === "superadmin");
  const junk = fakeStore({ "dd69.admin.role": "not json at all" });
  ok("junk is not a role", rememberedRole(now, junk) === null);
  const noUntil = fakeStore({ "dd69.admin.role": JSON.stringify({ role: "admin" }) });
  ok("a line with no date is not a role", rememberedRole(now, noUntil) === null);
}

/* ---- the secret, kept in one place ---- */
{
  ok("the key is the one all four panels use", ADMIN_SECRET_KEY === "dd69.admin.rebelsDropsSecret");
  const kv = fakeStore();
  ok("no secret reads as empty", readSecret(kv) === "");
  writeSecret("hunter2", kv);
  ok("a secret is kept", readSecret(kv) === "hunter2");
  writeSecret("", kv);
  ok("and clearing it clears it", readSecret(kv) === "");
}

/* ---- the whole check, as a page runs it ---- */
{
  /* No secret typed in this browser yet: ask nothing, keep what was known. The
     point is that an admin who opened the door on Monday is not thrown out on
     Tuesday for not having retyped the secret. */
  const kv = fakeStore();
  const now = 1_760_000_000_000;
  rememberRole("superadmin", now, kv);
  const quiet = answers("superadmin");
  ok("with no secret stored the remembered answer stands",
    (await checkRole(quiet.call, now, kv)) === "superadmin");
  ok("and the database was not troubled", quiet.calls.length === 0);

  /* A wrong secret must take the door away rather than leave it open. */
  const refused = answers("user");
  writeSecret("wrong", kv);
  ok("a wrong secret answers no", (await checkRole(refused.call, now, kv)) === null);
  ok("and the remembered yes is gone with it", rememberedRole(now, kv) === null);

  /* The ordinary case: the secret is right, and the gear is there next time
     without a query string. */
  const good = answers("superadmin");
  const fresh = fakeStore({ [ADMIN_SECRET_KEY]: "right" });
  ok("the right secret opens the door", (await checkRole(good.call, now, fresh)) === "superadmin");
  ok("and that is remembered for next time", rememberedRole(now + 60_000, fresh) === "superadmin");

  /* A database nobody can reach closes the door rather than opening it. */
  const broken = answers("superadmin", { throws: true });
  ok("an unreachable database is a no", (await checkRole(broken.call, now, fresh)) === null);
  ok("and it does not leave a stale yes behind", rememberedRole(now, fresh) === null);
}

/* ---- the door in the address bar ---- */
{
  ok("an ordinary visit asks for nothing", doorAsk("") === null);
  ok("so does the game's own query", doorAsk("?phone=1") === null);
  ok("?admin=1 asks to come in", doorAsk("?admin=1") === "in");
  ok("?admin=yes does too", doorAsk("?admin=yes") === "in");
  ok("?admin=0 asks to be let out", doorAsk("?admin=0") === "out");
  ok("so does ?admin=out", doorAsk("?admin=out") === "out");
  ok("and ?admin=false", doorAsk("?admin=FALSE") === "out");
  ok("it is found among other things", doorAsk("?phone=1&admin=1") === "in");
}

/* ---- types line up with LW-SSO's own roles ---- */
{
  /* LW-SSO's profiles.role is one of user, admin, superadmin (see
     /Users/geoffreymccabe/sso/src/app/api/admin/users/[id]/route.ts). The two
     privileged ones are the two this file accepts, so a signed-in identity can
     later answer the same question without changing anything here. */
  const roles: AdminRole[] = ["admin", "superadmin"];
  ok("both privileged roles are accepted", roles.every((r) => roleFrom(r) === r));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures) process.exit(1);
