import { useState } from "react";
import { TOKENS, TOKEN_GROUPS, type TokenDef } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { hexToHslTriplet, hslTripletToHex } from "../../theme/color";
import { playSound, type SoundEvent } from "../../sound";
import { Icon } from "../../Icon";

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

  if (token.type === "font" || token.type === "select") {
    // Sound waveform selects (clickWave/sendWave/receiveWave) get a note button
    // and play the tone the instant you change or click it.
    const soundEvent =
      token.group === "Sounds" ? (token.key.replace("Wave", "") as SoundEvent) : null;
    const onSelect = (v: string) => {
      if (soundEvent) document.documentElement.style.setProperty(token.cssVar, v);
      setToken(token.key, v);
      if (soundEvent) playSound(soundEvent);
    };
    return (
      <label className="style-row">
        <span>{token.label}</span>
        <span className="style-select-wrap">
          <select className="style-select" value={value} onChange={(e) => onSelect(e.target.value)}>
            {token.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {soundEvent && (
            <button
              type="button"
              className="note-btn"
              aria-label={`Play ${soundEvent} sound`}
              onClick={() => playSound(soundEvent)}
            >
              <Icon name="note" size={15} />
            </button>
          )}
        </span>
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
  const { reset, saved, saveCurrent, applySaved, deleteSaved, builtinSkins, applySkin } = useTheme();
  const [name, setName] = useState("");

  return (
    <div className="style-panel">
      <section className="style-group">
        <h3>Skins</h3>
        <ul className="style-saved">
          {builtinSkins.map((s) => (
            <li key={s.id}>
              <button type="button" className="style-apply" onClick={() => applySkin(s.id)}>
                {s.name}
                {s.free && <span className="skin-badge">Free</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="style-note">
          Design and sell your own skin — a paid marketplace (in DIVI) is coming; your saved themes
          below are the starting point.
        </p>
      </section>

      {TOKEN_GROUPS.map((group) => (
        <section key={group} className="style-group">
          <h3>{group}</h3>
          {TOKENS.filter((t) => t.group === group).map((t) => (
            <Control key={t.key} token={t} />
          ))}
          {group === "Sounds" && (
            <div className="sound-test">
              <button type="button" className="wl-btn" onClick={() => playSound("click")}>Test click</button>
              <button type="button" className="wl-btn" onClick={() => playSound("send")}>Test send</button>
              <button type="button" className="wl-btn" onClick={() => playSound("receive")}>Test receive</button>
            </div>
          )}
        </section>
      ))}

      <section className="style-group">
        <h3>My themes</h3>
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
        <button type="button" className="style-btn" onClick={reset}>
          Reset to Divilicious default
        </button>
      </section>
    </div>
  );
}
