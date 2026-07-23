import { useRef, useState } from "react";
import silhouette from "../assets/agent-silhouette.webp";
import silhouetteCreate from "../assets/agent-silhouette-create.webp";
import { loadIdentity, saveIdentity, imageToAvatar } from "./nodeIdentity";

// "My Agent" — first placeholder pass. Left column: heading, tabs (CREATE / CHAT
// / STATS, reusing the Proof-of-Existence tab styling), sub-tabs (IMAGE / PERSONA
// / KNOWLEDGE) and intro text. Right panel: the character images; clicking
// "Create my own" swaps the grid for the name/description controls beside it.

const gridPortrait = {
  WebkitMaskImage: `url(${silhouette})`,
  maskImage: `url(${silhouette})`,
} as const;
const createPortrait = {
  WebkitMaskImage: `url(${silhouetteCreate})`,
  maskImage: `url(${silhouetteCreate})`,
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
  const [creating, setCreating] = useState(false);
  // Seed from the saved persona so a name/description/avatar survives a reload.
  const saved = loadIdentity();
  const [name, setName] = useState(saved.name);
  const [description, setDescription] = useState(saved.description);
  const [avatar, setAvatar] = useState(saved.avatar);
  const [builtin, setBuiltin] = useState<number | null>(saved.builtin);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (patch: Partial<ReturnType<typeof loadIdentity>>) =>
    saveIdentity({ ...loadIdentity(), name, description, avatar, builtin, ...patch });

  const pickFile = async (f: File) => {
    setImgErr(null);
    try {
      const { avatar: a, thumb } = await imageToAvatar(f);
      setAvatar(a);
      setBuiltin(null);
      persist({ avatar: a, thumb, builtin: null });
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : String(e));
    }
  };

  const chooseBuiltin = (i: number) => {
    setBuiltin(i);
    setAvatar("");
    persist({ builtin: i, avatar: "", thumb: "" });
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
          <h3 className="agent-setup-head">Set up my agent</h3>

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
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                  e.target.value = "";
                }}
              />
              {imgErr && <p className="wl-err">{imgErr}</p>}
              <button
                type="button"
                className={"agent-tile agent-tile-create" + (creating ? " agent-tile-on" : "")}
                onClick={() => setCreating((c) => !c)}
              >
                <span className="agent-portrait" style={createPortrait} aria-hidden />
                <span className="agent-create-q">?</span>
                <span className="agent-create-label">CREATE MY OWN</span>
              </button>

              {creating ? (
                <div className="agent-form">
                  {/* Your own image — click or drag a file. Shows the picked
                      image in place so it doubles as confirmation it saved. */}
                  <div className="agent-field">
                    <span>Image</span>
                    <button
                      type="button"
                      className={"agent-upload" + (avatar ? " agent-upload-has" : "")}
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) pickFile(f);
                      }}
                      title="Upload an image, or drag one here"
                    >
                      {avatar ? (
                        <img className="agent-avatar-img" src={avatar} alt="" />
                      ) : (
                        <span className="agent-upload-hint">
                          Click to upload an image
                          <br />
                          <small>or drag one here</small>
                        </span>
                      )}
                    </button>
                    {avatar && (
                      <button
                        type="button"
                        className="wl-link"
                        style={{ fontSize: "0.7rem", marginTop: 4 }}
                        onClick={() => {
                          setAvatar("");
                          persist({ avatar: "", thumb: "" });
                        }}
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                  <label className="agent-field">
                    <span>Name</span>
                    <input
                      className="wl-input agent-input"
                      placeholder="Give your agent a name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        persist({ name: e.target.value });
                      }}
                      spellCheck={false}
                    />
                  </label>
                  <label className="agent-field">
                    <span>Description</span>
                    <textarea
                      className="wl-input agent-input agent-textarea"
                      placeholder="Describe your agent's personality, voice, and what it should help with..."
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        persist({ description: e.target.value });
                      }}
                    />
                  </label>
                </div>
              ) : (
                // The grid is the curated character set (filled from the Admin
                // panel). Uploading your own lives in the Creator, not here.
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
              )}
            </div>
          ) : (
            <p className="wl-note agent-soon">{soon}</p>
          )}
        </div>
      </div>
    </div>
  );
}
