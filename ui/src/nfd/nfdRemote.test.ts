// Getting NFD collections in and out of the database, and what happens when
// the row is not what we last wrote.

import {
  fetchCollections, fetchEnabledCollections, fetchTierMaps,
  saveCollection, enableCollection, deleteCollection, toRow, type NfdStore,
} from "./nfdRemote";
import { readLaunchFile, validateCollection, KINETINK_MEDIA_HOST, LAUNCH_FORMAT } from "./nfdCatalog";

const out: string[] = [];
let failures = 0;
function ok(what: string, pass: boolean, note = "") {
  out.push(`${pass ? "PASS" : "FAIL"} ${what}${note ? `  [${note}]` : ""}`);
  if (!pass) failures++;
}

const url = (p: string) => `https://${KINETINK_MEDIA_HOST}/storage/v1/object/public/character-images/${p}`;
const item = (edition: number, over: Record<string, unknown> = {}) => ({
  edition, name: `Rebel ${edition}`, description: "a ship", tier: edition * 10,
  rarity: "common", rarityLabel: "common", isUltraRare: false,
  media: { image: url(`${edition}.webp`), animation: null, isBoomerang: false },
  attributes: [{ trait_type: "Tier", value: String(edition * 10) }],
  ...over,
});
const launch = {
  format: LAUNCH_FORMAT, version: 1,
  collection: {
    name: "Divi Rebels", description: "the set", aspectRatio: "5:7",
    packagedArt: url("sealed.webp"),
    ultraRare: { basicChance: 0.01, progressiveFactor: 0.2, count: 10 },
    images: { logo: { url: url("logo.webp") }, featured: null, banner: null },
  },
  items: [item(1), item(2), item(3)],
};
const read = readLaunchFile(launch, "divi-rebels");
if (!("ok" in read)) { console.log("the sample launch file does not read: " + read.errors.join("; ")); process.exit(1); }
const sample = read.ok;

/* A fake database. Records every request so the test can look at what was
   actually sent, which is the only way to check the things that matter here:
   that the filtering is done by the database and that the secret is in the
   body rather than the address. */
interface Call { fn: string; args: Record<string, unknown> }
function store(
  rows: unknown[], over: Partial<{ status: number; body: unknown; throws: string }> = {},
): NfdStore & { reads: string[]; calls: Call[] } {
  const reads: string[] = [];
  const calls: Call[] = [];
  const res = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
  return {
    reads, calls,
    read: async (q) => {
      reads.push(q);
      if (over.throws) throw new Error(over.throws);
      return res(over.body ?? rows, over.status ?? 200);
    },
    call: async (fn, args) => {
      calls.push({ fn, args });
      if (over.throws) throw new Error(over.throws);
      return res(over.body ?? null, over.status ?? 200);
    },
  };
}
const row = (over: Record<string, unknown> = {}) => {
  const r = toRow(sample);
  return { id: r.id, collection: r.collection, enabled: false, ...over };
};

/* ================= THE SEAM: WHAT GOES IN A ROW ================= */
{
  const r = toRow({ ...sample, enabled: true });
  const c = r.collection as Record<string, unknown>;
  /* The one thing a save must NOT be able to do. Re-uploading a corrected
     file should not switch a set on, and should not switch a live one off. */
  ok("a saved row carries no `enabled` at all", !("enabled" in c),
     Object.keys(c).sort().join(","));
  ok("so an enabled collection and a disabled one save identically",
     JSON.stringify(toRow({ ...sample, enabled: true }).collection)
     === JSON.stringify(toRow({ ...sample, enabled: false }).collection));
  /* The id is the primary key. Keeping a second copy inside the JSON is how
     the two come to disagree after a rename. */
  ok("and the id lives in the key column, not twice", !("id" in c));
  ok("the id is still sent, as the key", r.id === "divi-rebels", r.id);
}

/* ================= AND WHAT COMES BACK OUT ================= */
{
  const s = store([row()]);
  const got = await fetchCollections(s);
  ok("a row written by toRow reads back", got.collections.length === 1 && got.live,
     got.error ?? "");
  const back = got.collections[0];
  ok("and reads back as the same collection",
     JSON.stringify({ ...back, enabled: false }) === JSON.stringify({ ...sample, enabled: false }));
  ok("with the id taken from the key column", back.id === "divi-rebels");
  ok("and `enabled` taken from its own column",
     back.enabled === false
     && (await fetchCollections(store([row({ enabled: true })]))).collections[0].enabled === true);
}

/* ================= A ROW NOBODY'S PANEL WROTE =================
   The reason reading a row is a validation and not a cast: a row can have been
   written by an older panel, or by hand in the SQL editor. */
{
  const bent = row();
  (bent.collection as Record<string, unknown>).items =
    [{ ...item(1), media: { image: "https://evil.test/?x=" + KINETINK_MEDIA_HOST, animation: null } }];
  const s = store([bent, row({ id: "second-set" })]);
  const got = await fetchCollections(s);
  ok("a row whose art moved off the allowed host is refused on the way OUT",
     !got.collections.some((c) => c.id === "divi-rebels"),
     got.error ?? "no error reported");
  ok("and it is named, rather than silently dropped",
     (got.error ?? "").includes("divi-rebels"), got.error ?? "");
  ok("while the rows beside it still load",
     got.collections.length === 1 && got.collections[0].id === "second-set");
  /* A hand-written row is also the way `enabled` could arrive as a string. */
  const odd = await fetchCollections(store([row({ enabled: "yes" })]));
  ok("anything but a true boolean counts as off",
     odd.collections.length === 1 && odd.collections[0].enabled === false);
}

/* ================= WHO DOES THE FILTERING ================= */
{
  const s = store([]);
  await fetchEnabledCollections(s);
  ok("the enabled-only read asks the DATABASE to filter",
     s.reads[0].includes("enabled=is.true"), s.reads[0]);
  const a = store([]);
  await fetchCollections(a);
  ok("while the admin read asks for the switched-off ones too",
     !a.reads[0].includes("enabled="), a.reads[0]);
}

/* ================= THE ROOM'S READ ================= */
{
  const s = store([{ id: "divi-rebels", tiers: { "1": 10, "2": 20, "3": 30 } }]);
  const { tierOf, live } = await fetchTierMaps(s);
  /* `includes("collection")` would be true of the TABLE NAME, so the check is
     against the select list alone. The first version of this test passed for
     the wrong reason and then failed for the right one. */
  const selected = (q: string) => (/select=([^&]*)/.exec(q)?.[1] ?? "").split(",");
  ok("the room's read fetches tiers and nothing else",
     selected(s.reads[0]).join(",") === "id,tiers", s.reads[0]);
  ok("and only from collections that count", s.reads[0].includes("enabled=is.true"));
  ok("a tier comes back for an edition we know", live && tierOf("divi-rebels", 3) === 30);
  /* These two must be distinguishable from a real tier, and from each other's
     absence, because a benefit is being decided on the answer. */
  ok("an edition we have never heard of is NOT tier zero",
     tierOf("divi-rebels", 99) === null, String(tierOf("divi-rebels", 99)));
  ok("nor is a collection we have never heard of",
     tierOf("some-other-set", 1) === null, String(tierOf("some-other-set", 1)));
  /* The weight of the saving, stated rather than claimed. */
  const whole = JSON.stringify(row()).length;
  const tiers = JSON.stringify({ id: "divi-rebels", tiers: { "1": 10, "2": 20, "3": 30 } }).length;
  ok("which is why tiers is a column and not a field",
     tiers * 8 < whole, `${tiers} bytes against ${whole} for the whole row, on a 3-item set`);
}

/* ================= WHEN THE DATABASE DOES NOT ANSWER ================= */
{
  const missing = await fetchCollections(store([], { status: 404 }));
  ok("a table that does not exist yet is an empty list, not a crash",
     missing.collections.length === 0 && missing.live === false, missing.error ?? "");
  const thrown = await fetchCollections(store([], { throws: "offline" }));
  ok("and so is no network at all",
     thrown.collections.length === 0 && thrown.live === false, thrown.error ?? "");
  const t = await fetchTierMaps(store([], { throws: "offline" }));
  ok("the room's read fails to `we do not know`, never to tier zero",
     t.live === false && t.tierOf("divi-rebels", 1) === null);
}

/* ================= SAVING ================= */
{
  const s = store([]);
  const bad = await saveCollection(s, "the-secret", { ...sample, items: [] });
  ok("a collection with nothing in it is refused BEFORE it is sent",
     "error" in bad && s.calls.length === 0, "error" in bad ? bad.error : "accepted");

  const good = await saveCollection(s, "the-secret", sample);
  ok("a good one is sent", "ok" in good && s.calls.length === 1);
  ok("to the save function", s.calls[0]?.fn === "rebels_nfd_save", s.calls[0]?.fn);
  ok("and the save carries no `enabled`",
     !("p_enabled" in (s.calls[0]?.args ?? {})),
     Object.keys(s.calls[0]?.args ?? {}).sort().join(","));

  const e = store([]);
  await enableCollection(e, "the-secret", "divi-rebels", true);
  ok("switching one on is its own call",
     e.calls[0]?.fn === "rebels_nfd_enable" && e.calls[0]?.args.p_enabled === true);
  const d = store([]);
  await deleteCollection(d, "the-secret", "divi-rebels");
  ok("and so is forgetting one", d.calls[0]?.fn === "rebels_nfd_delete");

  /* The secret must never end up anywhere a URL is logged, cached or shared.
     It travels in the body of a POST. Checked against the addresses that were
     actually built, not against the call sites: a read is done on each of
     these stores first, so there IS an address to look at. The first version
     of this check inspected three stores that had never read anything, and
     passed on an empty string. */
  await fetchCollections(s); await fetchCollections(e); await fetchCollections(d);
  const addresses = [...s.reads, ...e.reads, ...d.reads];
  const fns = [...s.calls, ...e.calls, ...d.calls].map((c) => c.fn);
  ok("the admin secret is never put in an address",
     addresses.length === 3 && !addresses.join(" ").includes("the-secret"),
     `${addresses.length} addresses checked`);
  ok("nor in a function name", !fns.join(" ").includes("the-secret"), fns.join(","));
  ok("it is only ever a named argument in the body",
     [...s.calls, ...e.calls, ...d.calls].every((c) => c.args.p_secret === "the-secret"),
     `${s.calls.length + e.calls.length + d.calls.length} calls`);

  /* What the panel shows when the database says no. "http 400" is useless to
     Geoff; "not the admin secret" is the whole answer. */
  const refused = await enableCollection(
    store([], { status: 400, body: { message: "not the admin secret" } }),
    "wrong", "divi-rebels", true);
  ok("a refusal says what the database said, not its status code",
     "error" in refused && refused.error === "not the admin secret",
     "error" in refused ? refused.error : "accepted");
  const silent = await enableCollection(store([], { status: 500, body: "<html>" }), "x", "y", true);
  ok("and falls back to the status when there is nothing to quote",
     "error" in silent && silent.error === "http 500",
     "error" in silent ? silent.error : "accepted");
}

/* ================= THE STORED SHAPE, CHECKED DIRECTLY ================= */
{
  const bad = validateCollection({ ...sample, logo: "http://" + KINETINK_MEDIA_HOST + "/l.webp" }, "divi-rebels");
  ok("plain http is refused in the stored shape too, not just in a launch file",
     "errors" in bad, "errors" in bad ? bad.errors[0] : "accepted");
  const noId = validateCollection(sample, "Divi_Rebels");
  ok("and an id that is not a safe key is refused",
     "errors" in noId, "errors" in noId ? noId.errors[0] : "accepted");
  /* A launch file forces `enabled` off. A row does not, because by then an
     admin has already had their say. */
  const fresh = readLaunchFile({ ...launch }, "divi-rebels");
  ok("a freshly read launch file is always switched off",
     "ok" in fresh && fresh.ok.enabled === false);
  const saved = validateCollection({ ...sample, enabled: true }, "divi-rebels");
  ok("but a row that says it is on, is on", "ok" in saved && saved.ok.enabled === true);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
