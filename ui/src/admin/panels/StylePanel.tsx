import { useState } from "react";
import { TOKENS, TOKEN_GROUPS, type TokenDef } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { hexToHslTriplet, hslTripletToHex } from "../../theme/color";

function Control({ token }: { token: TokenDef }) {
  const { theme, setToken } = useTheme();
  const value = theme[token.key] ?? token.default;

  if (token.type === "color") {
    return (
      <label className="style-row">
        <span>{token.label}</span>
        <input
          type="color"
          className="style-color"
          value={hslTripletToHex(value)}
          onChange={(e) => setToken(token.key, hexToHslTriplet(e.target.value))}
        />
      </label>
    );
  }

  if (token.type === "font") {
    return (
      <label className="style-row">
        <span>{token.label}</span>
        <select
          className="style-select"
          value={value}
          onChange={(e) => setToken(token.key, e.target.value)}
        >
          {token.options?.map((o) => (
            <option key={o.label} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // range
  const num = parseFloat(value) || 0;
  return (
    <label className="style-row">
      <span>
        {token.label} <em className="style-val">{num}{token.unit}</em>
      </span>
      <input
        type="range"
        className="style-range"
        min={token.min}
        max={token.max}
        step={token.step}
        value={num}
        onChange={(e) => setToken(token.key, `${e.target.value}${token.unit ?? ""}`)}
      />
    </label>
  );
}

export function StylePanel() {
  const { reset, saved, saveCurrent, applySaved, deleteSaved } = useTheme();
  const [name, setName] = useState("");

  return (
    <div className="style-panel">
      {TOKEN_GROUPS.map((group) => (
        <section key={group} className="style-group">
          <h3>{group}</h3>
          {TOKENS.filter((t) => t.group === group).map((t) => (
            <Control key={t.key} token={t} />
          ))}
        </section>
      ))}

      <section className="style-group">
        <h3>Themes</h3>
        <div className="style-save">
          <input
            className="style-name"
            placeholder="Name this theme…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="style-btn style-btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              saveCurrent(name);
              setName("");
            }}
          >
            Save
          </button>
        </div>

        {saved.length > 0 && (
          <ul className="style-saved">
            {saved.map((s) => (
              <li key={s.id}>
                <button type="button" className="style-apply" onClick={() => applySaved(s.id)}>
                  {s.name}
                </button>
                <button type="button" className="style-del" aria-label="Delete" onClick={() => deleteSaved(s.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="style-note">
          Sharing &amp; selling themes for DIVI is coming — saved themes are the foundation.
        </p>
        <button type="button" className="style-btn" onClick={reset}>
          Reset to default
        </button>
      </section>
    </div>
  );
}
