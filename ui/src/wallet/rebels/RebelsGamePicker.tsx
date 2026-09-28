import { useEffect, useState } from "react";
import { fetchGameCards, type GameCard } from "./gameTypesRemote";
import { PLACE_NAMES } from "./gameTypes";

// The screen a player chooses a game from.
//
// Geoff: "The user can start the game, and choose different games from a
// panel, some are solo missions, some are multiplayer, etc."
//
// It is the launch card's twin and deliberately shares its look - the same
// scrim, the same blur, the same heading - because it appears in the same
// place for the same reason. Choosing a game IS launching now; the old single
// LAUNCH button is the case where there is exactly one.
//
// WHAT IT DOES NOT DO: fetch a single round description. The table is one row
// per game with the picture in its own column precisely so this can ask for
// names and cards and nothing else. Twenty games here is twenty small
// pictures, not twenty pictures AND twelve hundred rounds of spawn tables.

export interface PickerProps {
  /** Chosen: the game's id, and where it is played. */
  onPick(id: string, place: string): void;
  /** Backing out to the ordinary launch card. */
  onCancel?(): void;
  /** For tests, so this can be driven without a network. */
  load?: () => Promise<GameCard[]>;
}

export function RebelsGamePicker({ onPick, onCancel, load = fetchGameCards }: PickerProps) {
  const [cards, setCards] = useState<GameCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void load()
      .then((c) => { if (alive) setCards(c); })
      .catch(() => { if (alive) { setCards([]); setFailed(true); } });
    return () => { alive = false; };
  }, [load]);

  /* ---- NEVER AN EMPTY SCREEN ----
     A player who reaches this must always be able to fly. If the list cannot
     be fetched, or nothing is published, the built-in is still there and the
     card says so rather than the screen being blank with a button that does
     nothing. */
  const list = cards ?? [];

  return (
    <div className="orbit-card orbit-picker">
      <h2>CHOOSE A GAME</h2>
      {cards === null ? (
        <p>Finding the games…</p>
      ) : (
        <>
          {failed ? <p className="orbit-picker-note">Could not reach the game list. The one below always works.</p> : null}
          <div className="orbit-picker-grid">
            {list.map((c) => (
              <button type="button" key={c.id} className="orbit-picker-card"
                onClick={() => onPick(c.id, c.place)}>
                <span className="orbit-picker-art"
                  style={c.image ? { backgroundImage: `url(${c.image})` } : undefined}>
                  {c.image ? null : <span className="orbit-picker-noart">{c.name}</span>}
                </span>
                <span className="orbit-picker-name">{c.name}</span>
                <span className="orbit-picker-where">
                  {PLACE_NAMES[c.place] ?? c.place}
                  {c.crew === "solo" ? " · on your own" : " · everyone together"}
                </span>
              </button>
            ))}
          </div>
          {list.length === 0 ? <p>No games are published yet.</p> : null}
        </>
      )}
      {onCancel ? <button type="button" onClick={onCancel}>BACK</button> : null}
    </div>
  );
}
