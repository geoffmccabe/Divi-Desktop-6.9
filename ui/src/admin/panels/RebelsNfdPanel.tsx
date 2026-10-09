import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  readLaunchFile, normalsOf, ultraRaresOf, topTierOf, ultraRareOdds, cssAspect,
  KINETINK_MEDIA_HOST, LAUNCH_FORMAT,
  type NfdCollection, type NfdItem,
} from "../../nfd/nfdCatalog";
import {
  fetchCollections, saveCollection, enableCollection, deleteCollection,
} from "../../nfd/nfdRemote";
import { nfdStore } from "../../wallet/rebels/nfdStore";
import { nfdBenefits, benefitLines } from "../../wallet/rebels/nfdBenefits";
import "./rebels-nfd.css";

// Admin: Rebels NFDs. Which collections of Divi collectibles count in the game.
//
// Geoff: "only specific NFD collections would be useful in the game and
// anything else will not show", and the panel is where that is decided.
//
// TWO SEPARATE ACTS, deliberately. Uploading a launch file SAVES a collection;
// it does not switch it on. Switching one on is its own button and its own
// database call, so re-uploading a corrected file cannot quietly make a set
// count, and cannot stop a live one counting either.
//
// WHO CAN GET IN. The same gate as the Drops, Enemies and Games panels: the
// admin secret, held in public.rebels_admin where nothing can read it through
// the API. There is no role check yet because there are no roles yet; when
// LW-Auth lands, the check moves there for all four panels at once. Until
// then the panel is visible to anyone who opens the gear and useless to them
// without the secret.

const SECRET_KEY = "dd69.admin.rebelsDropsSecret";

export function RebelsNfdPanel() {
  const [saved, setSaved] = useState<NfdCollection[]>([]);
  const [source, setSource] = useState("loading");
  const [pick, setPick] = useState("");
  const [secret, setSecret] = useState(() => {
    try { return localStorage.getItem(SECRET_KEY) ?? ""; } catch { return ""; }
  });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  /* The upload half: an id the admin types once, the file they paste or pick,
     and whatever reading it had to say. A refused file is held HERE and never
     reaches `saved`, so a half-read collection cannot be looked at as though
     it were real. */
  const [newId, setNewId] = useState("");
  const [paste, setPaste] = useState("");
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<NfdCollection | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const r = await fetchCollections(nfdStore);
    setSaved(r.collections);
    setSource(r.live
      ? `${r.collections.length} collection${r.collections.length === 1 ? "" : "s"}${r.error ? `, ${r.error}` : ""}`
      : `cannot read them (${r.error ?? "no answer"})`);
    setPick((p) => (r.collections.some((c) => c.id === p) ? p : (r.collections[0]?.id ?? "")));
  };
  useEffect(() => { void reload(); }, []);

  const chosen = pending ?? saved.find((c) => c.id === pick) ?? null;
  const isPending = pending !== null;
  const normals = useMemo(() => (chosen ? normalsOf(chosen) : []), [chosen]);
  const ultras = useMemo(() => (chosen ? ultraRaresOf(chosen) : []), [chosen]);
  const top = chosen ? topTierOf(chosen) : 0;
  const odds = useMemo(() => ultraRareOdds(chosen?.ultraRare ?? null), [chosen]);
  const canWrite = secret.trim().length > 0;

  /* ---- READING A FILE ---- */
  const readIt = (text: string) => {
    setReadErrors([]);
    setPending(null);
    const id = newId.trim();
    if (!id) { setReadErrors(["type a short id for this collection first, e.g. divi-rebels"]); return; }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
      setReadErrors([`that is not JSON: ${String((e as Error)?.message ?? e)}`]);
      return;
    }
    const r = readLaunchFile(raw, id);
    if ("errors" in r) { setReadErrors(r.errors); return; }
    setPending(r.ok);
    setStatus(`read ${r.ok.items.length} items. Nothing is saved yet.`);
  };

  const pickFile = async (f?: File) => {
    if (!f) return;
    /* A launch file is JSON and small. The cap is here so a mis-picked video
       is refused by size before it is read into memory as text. */
    if (f.size > 8_000_000) { setReadErrors(["that file is far too big to be a launch package"]); return; }
    readIt(await f.text());
  };

  /* ---- WRITING ---- */
  const run = async (what: string, go: () => Promise<{ ok: true } | { error: string }>) => {
    setBusy(true);
    setStatus(`${what}...`);
    const r = await go();
    setBusy(false);
    if ("error" in r) { setStatus(`${what} failed: ${r.error}`); return false; }
    setStatus(`${what}: done`);
    return true;
  };

  const save = async () => {
    if (!chosen) return;
    const ok = await run("saving", () => saveCollection(nfdStore, secret.trim(), chosen));
    if (!ok) return;
    setPending(null);
    setPaste("");
    setNewId("");
    await reload();
    setPick(chosen.id);
  };

  const flip = async (on: boolean) => {
    if (!chosen || isPending) return;
    if (await run(on ? "switching on" : "switching off",
                  () => enableCollection(nfdStore, secret.trim(), chosen.id, on))) await reload();
  };

  const remove = async () => {
    if (!chosen || isPending) return;
    if (await run("forgetting it", () => deleteCollection(nfdStore, secret.trim(), chosen.id))) await reload();
  };

  const card = (it: NfdItem) => (
    <figure className="rn-card" key={it.edition}>
      {/* Only ever Kinetink's one media host: every URL here has been through
          mediaUrlOk, which parses it rather than pattern-matching it. */}
      <img src={it.media.image} alt={it.name} loading="lazy" decoding="async" />
      <figcaption>
        <span className="rn-card-name">{it.name}</span>
        <span className="rn-card-meta">
          <span className="rn-tier">T{it.tier}</span>
          <span className="rn-rarity">{it.rarityLabel}</span>
          {it.media.animation ? <span className="rn-moving">moving</span> : null}
        </span>
      </figcaption>
    </figure>
  );

  return (
    <div className="admin-panel rn-panel">
      <p className="wl-note">
        Which collections of Divi collectibles count in Divi Rebels. A set is read from the launch
        package Kinetink exports, saved, and then switched on as a separate step, so correcting a
        file can never change what is live by accident. Pictures are only ever loaded from{" "}
        <code>{KINETINK_MEDIA_HOST}</code>; a set pointing anywhere else is refused whole rather
        than part-read. Showing: {source}.
      </p>

      <div className="rn-split">
        <div className="rn-side">
          <div className="rn-list">
            {saved.length === 0 && !isPending
              ? <span className="rn-hint">No collections yet. Add one on the right.</span>
              : null}
            {saved.map((c) => (
              <button type="button" key={c.id} className={`rn-item${c.id === pick && !isPending ? " on" : ""}`}
                onClick={() => { setPending(null); setPick(c.id); }}>
                <span className="rn-item-name">{c.name}</span>
                <span className="rn-tag">{c.items.length}</span>
                <span className={`rn-tag${c.enabled ? " rn-on" : " rn-off"}`}>{c.enabled ? "counts" : "off"}</span>
              </button>
            ))}
            {isPending
              ? <span className="rn-item on rn-unsaved">{pending?.name} (not saved)</span>
              : null}
          </div>

          <section className="rn-add">
            <label className="rn-field">
              <span>Short id, typed once</span>
              <input className="wl-input" value={newId} placeholder="divi-rebels"
                onChange={(e) => setNewId(e.target.value)} />
            </label>
            <input ref={file} type="file" accept="application/json,.json" hidden
              onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="rn-btn" onClick={() => file.current?.click()}>
              choose a launch file
            </button>
            <span className="rn-hint">or paste it</span>
            <textarea className="wl-input rn-paste" rows={4} value={paste}
              placeholder={`{"format":"${LAUNCH_FORMAT}", ...`}
              onChange={(e) => setPaste(e.target.value)} />
            <button type="button" className="rn-btn" disabled={!paste.trim()} onClick={() => readIt(paste)}>
              read what I pasted
            </button>
            {readErrors.length ? (
              <div className="rn-errors">
                <strong>This file was not used. Nothing was saved.</strong>
                {readErrors.map((e) => <span key={e}>{e}</span>)}
              </div>
            ) : null}
          </section>
        </div>

        <section className="rn-main"
          style={chosen ? ({ "--rn-aspect": cssAspect(chosen.aspectRatio) } as CSSProperties) : undefined}>
          {!chosen ? (
            <p className="rn-hint">
              Pick a collection on the left, or read a launch file to see what is in it.
            </p>
          ) : (
            <>
              <header className="rn-head"
                style={chosen.banner ? { backgroundImage: `url(${chosen.banner})` } : undefined}>
                {chosen.logo ? <img className="rn-logo" src={chosen.logo} alt="" /> : null}
                <div className="rn-head-text">
                  <h3>{chosen.name}</h3>
                  <span className="rn-id">{chosen.id}</span>
                  {chosen.description ? <p>{chosen.description}</p> : null}
                </div>
                <span className={`rn-state${chosen.enabled && !isPending ? " rn-on" : " rn-off"}`}>
                  {isPending ? "not saved" : chosen.enabled ? "counts in the game" : "not counting"}
                </span>
              </header>

              <div className="rn-acts">
                <button type="button" className="rn-btn rn-primary" disabled={!canWrite || busy}
                  onClick={() => void save()}>
                  {isPending ? "SAVE THIS COLLECTION" : "SAVE CHANGES"}
                </button>
                <button type="button" className="rn-btn" disabled={!canWrite || busy || isPending || chosen.enabled}
                  onClick={() => void flip(true)}>
                  switch it on
                </button>
                <button type="button" className="rn-btn" disabled={!canWrite || busy || isPending || !chosen.enabled}
                  onClick={() => void flip(false)}>
                  switch it off
                </button>
                <button type="button" className="rn-btn rn-danger" disabled={!canWrite || busy || isPending}
                  onClick={() => void remove()}>
                  forget it
                </button>
                <span className="rn-hint">
                  {isPending
                    ? "Save it first. A saved collection always arrives switched off."
                    : "Forgetting a collection does not touch anybody's NFDs. They live on the Divi chain; the game just stops recognising the set."}
                </span>
              </div>

              {/* ---- WHAT OWNING THE TOP ONE IS WORTH ----
                  On the screen next to the set, because the set's top tier is
                  what decides it and a number nobody can see is a number
                  nobody checks. The same function the cockpit uses. */}
              <div className="rn-worth">
                <span className="rn-worth-head">
                  Top tier in this set is <strong>{top}</strong>. Owning it gives:
                </span>
                {benefitLines(nfdBenefits(top)).map((l) => (
                  <span className="rn-worth-line" key={l.label}>
                    <span>{l.label}</span><strong>{l.value}</strong>
                  </span>
                ))}
              </div>

              {odds.length ? (
                <details className="rn-odds">
                  <summary>
                    Ultra Rare odds: {odds.filter((o) => o.oneIn <= 1_000_000).length} of {odds.length}{" "}
                    turn up at least once per million rolls
                  </summary>
                  {/* The useful fact while a set is still being made: with a
                      1% gate and a steep factor, the tail of a ten-piece
                      Ultra Rare set is unreachable, so it is really a
                      six-piece one. The dial is Kinetink's progressiveFactor. */}
                  <div className="rn-odds-rows">
                    {odds.map((o) => (
                      <span key={o.slot} className={o.oneIn > 1_000_000 ? "rn-odds-row rn-faint" : "rn-odds-row"}>
                        <span>slot {o.slot}</span>
                        <strong>1 in {o.oneIn.toLocaleString()}</strong>
                      </span>
                    ))}
                  </div>
                  <span className="rn-hint">
                    Gate {(chosen.ultraRare!.basicChance * 100).toFixed(2)}%, factor{" "}
                    {chosen.ultraRare!.progressiveFactor}. A higher factor flattens the tail.
                  </span>
                </details>
              ) : null}

              {ultras.length ? (
                <>
                  <h4 className="rn-group">Ultra Rare &middot; {ultras.length}</h4>
                  <div className="rn-grid">{ultras.map(card)}</div>
                </>
              ) : null}

              <h4 className="rn-group">
                The set &middot; {normals.length}
                {chosen.packagedArt ? <span className="rn-hint"> (packaged art on the right)</span> : null}
              </h4>
              <div className="rn-grid">
                {normals.map(card)}
                {chosen.packagedArt ? (
                  <figure className="rn-card rn-packaged">
                    <img src={chosen.packagedArt} alt="packaged" loading="lazy" decoding="async" />
                    <figcaption>
                      <span className="rn-card-name">Packaged</span>
                      <span className="rn-card-meta"><span className="rn-rarity">what a dropped cube wears</span></span>
                    </figcaption>
                  </figure>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="rn-foot">
        <span className="wl-note">{status}</span>
        <input className="wl-input" type="password" placeholder="admin secret"
          value={secret} onChange={(e) => setSecret(e.target.value)} />
      </div>
    </div>
  );
}
