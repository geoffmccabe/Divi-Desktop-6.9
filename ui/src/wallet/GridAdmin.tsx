import { useRef, useState } from "react";
import { loadGrid, saveGrid, loadKeys, saveKeys, GRID_SIZE, type GridCharacter, type GridSlots } from "./gridCharacters";
import { fileToThumb } from "./nodeIdentity";

// Admin-only: assign a Kinetink character to each of the six grid slots. Shown
// inside the Creator when the connected node is one of the admin's own.
//
// The public character (name, image, description) and the secret api_key are
// edited together here but STORED SEPARATELY (see gridCharacters.ts) — the key
// never lives in the object that gets published.

const EMPTY: GridCharacter = { name: "", description: "", thumb: "" };

function SlotEditor({ index, slot, apiKey, onChange, onKey, onClear }: {
  index: number;
  slot: GridCharacter | null;
  apiKey: string;
  onChange: (c: GridCharacter) => void;
  onKey: (k: string) => void;
  onClear: () => void;
}) {
  const c = slot ?? EMPTY;
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (f: File) => {
    setErr(null);
    try {
      onChange({ ...c, thumb: await fileToThumb(f) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="gridadmin-slot">
      <div className="gridadmin-slot-num">Slot {index + 1}</div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className={"gridadmin-img" + (c.thumb ? " has" : "")}
        onClick={() => fileRef.current?.click()}
        title="Set this character's image"
      >
        {c.thumb ? <img src={c.thumb} alt="" /> : <span>+ image</span>}
      </button>
      {err && <p className="wl-err" style={{ fontSize: "0.68rem" }}>{err}</p>}
      <input
        className="wl-input"
        placeholder="Name"
        value={c.name}
        onChange={(e) => onChange({ ...c, name: e.target.value })}
        spellCheck={false}
      />
      <input
        className="wl-input"
        placeholder="Kinetink API key"
        value={apiKey}
        onChange={(e) => onKey(e.target.value.trim())}
        spellCheck={false}
        type="password"
        autoComplete="off"
      />
      <textarea
        className="wl-input gridadmin-desc"
        placeholder="Short description (optional)"
        value={c.description}
        onChange={(e) => onChange({ ...c, description: e.target.value })}
      />
      {(slot || apiKey) && (
        <button type="button" className="wl-link" style={{ fontSize: "0.68rem" }} onClick={onClear}>
          Clear slot
        </button>
      )}
    </div>
  );
}

export function GridAdmin() {
  const [slots, setSlots] = useState<GridSlots>(() => loadGrid());
  const [keys, setKeys] = useState<(string | null)[]>(() => loadKeys());
  const [dirty, setDirty] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const set = (i: number, c: GridCharacter | null) => {
    const next = slots.slice();
    next[i] = c;
    setSlots(next);
    setDirty(true);
    setSavedNote(false);
  };
  const setKey = (i: number, k: string) => {
    const next = keys.slice();
    next[i] = k || null;
    setKeys(next);
    setDirty(true);
    setSavedNote(false);
  };
  const clearSlot = (i: number) => {
    set(i, null);
    setKey(i, "");
  };

  const save = () => {
    // Drop empty slots (no name/thumb/key) to null.
    const cleaned = slots.map((s, i) => (s && (s.name || s.thumb) ? s : keys[i] ? s : null));
    saveGrid(cleaned); // public only — the secret keys are written separately
    saveKeys(keys);
    setSlots(loadGrid());
    setDirty(false);
    setSavedNote(true);
  };

  return (
    <section className="gridadmin">
      <h4 className="gridadmin-head">Admin — assign the six grid characters</h4>
      <p className="wl-note" style={{ fontSize: "0.72rem" }}>
        Create each character in Kinetink, then paste its API key here with a name and image. These become
        the characters everyone can pick from the grid. Saved on this machine for now.
      </p>

      <div className="gridadmin-grid">
        {Array.from({ length: GRID_SIZE }, (_, i) => (
          <SlotEditor
            key={i}
            index={i}
            slot={slots[i]}
            apiKey={keys[i] ?? ""}
            onChange={(c) => set(i, c)}
            onKey={(k) => setKey(i, k)}
            onClear={() => clearSlot(i)}
          />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button
          type="button"
          className={"wl-btn" + (dirty ? "" : " agent-save-off")}
          disabled={!dirty}
          onClick={save}
        >
          {dirty ? "SAVE CHARACTERS" : "SAVED"}
        </button>
        {savedNote && <span className="wl-note" style={{ fontSize: "0.72rem" }}>Grid updated.</span>}
      </div>
    </section>
  );
}
