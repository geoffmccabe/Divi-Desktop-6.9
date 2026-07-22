import { useState } from "react";

// "My Agent" — first placeholder pass. Set up the node's AI agent: give it a
// name + description, and pick a character (or create your own). Everything here
// is a visual starting point; the real agent-creation tooling comes next.

// Dark-purple filled silhouette of a female head with long hair. Same subject as
// the left-nav line icon; drawn filled so it reads as a placeholder portrait.
function HeadSilhouette() {
  return (
    <svg className="agent-silhouette" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M12 2 C8 2 5.5 5 5.5 9.5 C5.5 12 6.3 13.8 7.5 15 C6 16 5 18.2 5 21.5 L9 21.5 C9 19 8.6 17.2 9 15.4 C9.8 16.6 10.8 17.1 12 17.1 C13.2 17.1 14.2 16.6 15 15.4 C15.4 17.2 15 19 15 21.5 L19 21.5 C19 18.2 18 16 16.5 15 C17.7 13.8 18.5 12 18.5 9.5 C18.5 5 16 2 12 2 Z" />
    </svg>
  );
}

// Nine character slots. Placeholder for now — each will become one of Geoff's
// characters. Keys are stable so React is happy; labels are intentionally blank.
const CHARACTER_SLOTS = Array.from({ length: 9 }, (_, i) => i);

export function AgentPanel() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="agent-setup">
      <h3 className="agent-setup-head">Set up my agent</h3>

      <div className="agent-setup-body">
        <div className="agent-form">
          <label className="agent-field">
            <span>Name</span>
            <input
              className="wl-input agent-input"
              placeholder="Give your agent a name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="agent-field">
            <span>Description</span>
            <textarea
              className="wl-input agent-input agent-textarea"
              placeholder="Describe her personality, voice, and what she should help with…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>

        <div className="agent-chooser">
          <button type="button" className="agent-tile agent-tile-create">
            <span className="agent-create-q">?</span>
            <span className="agent-create-label">CREATE MY OWN</span>
          </button>

          <div className="agent-grid">
            {CHARACTER_SLOTS.map((i) => (
              <button key={i} type="button" className="agent-tile" aria-label="Character placeholder">
                <HeadSilhouette />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
