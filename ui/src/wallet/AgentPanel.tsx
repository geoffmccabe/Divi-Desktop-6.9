import { useEffect, useRef, useState } from "react";
import silhouette from "../assets/agent-silhouette.webp";
import { loadIdentity, saveIdentity, pickMedia, mediaUrl, clearMedia } from "./nodeIdentity";

// "My Agent" — first placeholder pass. Left column: heading, tabs (CREATE / CHAT
// / STATS, reusing the Proof-of-Existence tab styling), sub-tabs (IMAGE / PERSONA
// / KNOWLEDGE) and intro text. Right panel: the character images; clicking
// "Create my own" swaps the grid for the name/description controls beside it.

const gridPortrait = {
  WebkitMaskImage: `url(${silhouette})`,
  maskImage: `url(${silhouette})`,
} as const;

// Six curated characters — 2 rows of 3 (the grid CSS is 3 columns wide).
// Which character sits in each slot is assigned by Geoff; see the grid-assignment
// panel, which only appears for him.
const CHARACTER_SLOTS = Array.from({ length: 6 }, (_, i) => i);

type Tab = "create" | "chat" | "stats";
type SubTab = "image" | "persona" | "knowledge";

export function AgentPanel() {
  const [tab, setTab] = useState<Tab>("create");
  const [sub, setSub] = useState<SubTab>("image");
  const saved = loadIdentity();
  const [name, setName] = useState(saved.name);
  const [description, setDescription] = useState(saved.description);
  const [builtin, setBuiltin] = useState<number | null>(saved.builtin);
  const [mediaType, setMediaType] = useState(saved.mediaType);
  const [thumb, setThumb] = useState(saved.thumb);
  // Object URL for the stored original, so animated WebP and video actually play.
  const [preview, setPreview] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  // Typing must never touch storage — writing a whole persona per keystroke is
  // what would cause the lag. Nothing persists until SAVE.
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    let url: string | null = null;
    mediaUrl().then((u) => {
      if (dead) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setPreview(u);
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [mediaType, saved.updatedAt]);

  const isVideo = mediaType.startsWith("video/");

  const pickFile = async (f: File) => {
    setImgErr(null);
    try {
      const { mediaType: mt, thumb: th } = await pickMedia(f);
      setMediaType(mt);
      setThumb(th);
      setBuiltin(null);
      // Media is already written to IndexedDB by pickMedia, so save the metadata
      // with it — an image you can see but that vanishes on reload is worse than
      // no image at all.
      saveIdentity({ ...loadIdentity(), name, description, builtin: null, mediaType: mt, thumb: th, hasMedia: true });
      const u = await mediaUrl();
      setPreview(u);
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeMedia = async () => {
    await clearMedia();
    setPreview(null);
    setMediaType("");
    setThumb("");
    saveIdentity({ ...loadIdentity(), mediaType: "", thumb: "", hasMedia: false });
  };

  const chooseBuiltin = (i: number) => {
    setBuiltin(i);
    setDirty(true);
  };

  const save = () => {
    saveIdentity({ ...loadIdentity(), name, description, builtin, mediaType, thumb, hasMedia: !!mediaType });
    setDirty(false);
  };

  const soon =
    tab === "chat"
      ? "Chat with your agent — coming soon."
      : tab === "stats"
        ? "Agent stats — coming soon."
        : `${sub.toUpperCase()} — coming soon.`;

  return (
    <div className="agent-setup">
      <div className="agent-layout">
        {/* Left: heading, tabs, intro. */}
        <div className="agent-left">
          <h3 className="agent-setup-head">CREATE YOUR NODE CHARACTER</h3>

          <nav className="poe-tabs" role="tablist">
            {(["create", "chat", "stats"] as Tab[]).map((t) => (
              <button
                key={t}
                className={"poe-tab" + (tab === t ? " poe-tab-on" : "")}
                onClick={() => setTab(t)}
                role="tab"
                aria-selected={tab === t}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </nav>

          {tab === "create" && (
            <>
              <nav className="agent-subtabs" role="tablist">
                {(["image", "persona", "knowledge"] as SubTab[]).map((s) => (
                  <button
                    key={s}
                    className={"agent-subtab" + (sub === s ? " agent-subtab-on" : "")}
                    onClick={() => setSub(s)}
                    role="tab"
                    aria-selected={sub === s}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </nav>

              <p className="wl-note agent-intro">
                Use this section to set up your agent.
                <br />
                Choose one of ours, or pay a fee to create your own.
              </p>
            </>
          )}
        </div>

        {/* Right: the character images, filling the right side, top-aligned. */}
        <div className="agent-image-panel">
          {tab === "create" && sub === "image" ? (
            <div className="agent-chooser">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                  e.target.value = "";
                }}
              />
              {imgErr && <p className="wl-err">{imgErr}</p>}

              <div className="agent-form">
                {/* The ORIGINAL file is shown here, not a re-encode, so animated
                    WebP and short video actually play. */}
                <div className="agent-field">
                  <span>Image or video</span>
                  <button
                    type="button"
                    className={"agent-upload" + (preview ? " agent-upload-has" : "")}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) pickFile(f);
                    }}
                    title="Upload an image or short video, or drag one here"
                  >
                    {preview ? (
                      isVideo ? (
                        <video className="agent-avatar-img" src={preview} autoPlay loop muted playsInline />
                      ) : (
                        <img className="agent-avatar-img" src={preview} alt="" />
                      )
                    ) : (
                      <span className="agent-upload-hint">
                        Click to upload
                        <br />
                        <small>image, animation or short video &middot; up to 3MB</small>
                      </span>
                    )}
                  </button>
                  {preview && (
                    <button
                      type="button"
                      className="wl-link"
                      style={{ fontSize: "0.7rem", marginTop: 4 }}
                      onClick={removeMedia}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <label className="agent-field">
                  <span>Name</span>
                  <input
                    className="wl-input agent-input"
                    placeholder="Give your character a name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setDirty(true);
                    }}
                    spellCheck={false}
                  />
                </label>
                <label className="agent-field">
                  <span>Description</span>
                  <textarea
                    className="wl-input agent-input agent-textarea"
                    placeholder="Describe your character's personality, voice, and what it should help with..."
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                    }}
                  />
                </label>

                {/* Bright when there's something to save, greyed when there
                    isn't. Typing never writes to storage, so it can't lag. */}
                <button
                  type="button"
                  className={"wl-btn agent-save" + (dirty ? "" : " agent-save-off")}
                  disabled={!dirty}
                  onClick={save}
                >
                  {dirty ? "SAVE" : "SAVED"}
                </button>
              </div>

              {/* The curated set, assigned from the Admin panel. */}
              <div className="agent-grid">
                {CHARACTER_SLOTS.map((i) => (
                  <button
                    key={i}
                    type="button"
                    className={"agent-tile" + (builtin === i ? " agent-tile-on" : "")}
                    onClick={() => chooseBuiltin(i)}
                    aria-label={`Choose character ${i + 1}`}
                    aria-pressed={builtin === i}
                  >
                    <span className="agent-portrait" style={gridPortrait} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="wl-note agent-soon">{soon}</p>
          )}
        </div>
      </div>
    </div>
  );
}
