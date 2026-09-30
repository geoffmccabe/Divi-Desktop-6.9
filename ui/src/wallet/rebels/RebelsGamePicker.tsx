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
  /** Chosen: the game's id, and where it is played. Null is the built-in. */
  onPick(id: string | null, place: string): void;
  /** The game already chosen for each place, so the current one is marked. */
  chosen?: (place: string) => string | null;
  /** Backing out to the ordinary launch card. */
  onCancel?(): void;
  /** For tests, so this can be driven without a network. */
  load?: () => Promise<GameCard[]>;
}

export function RebelsGamePicker({ onPick, onCancel, chosen, load = fetchGameCards }: PickerProps) {
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

  /* ---- THE BUILT-IN IS ALWAYS ON THE LIST ----
     Not as a fallback for when the fetch fails, which is how it was first
     written, but as an ordinary choice that is always there. Without it a
     player who picks a game has no way back to the fight everyone else is
     in: every card leads somewhere, and none of them lead home. It carries
     no id because it is not a row in the table - null IS the built-in
     everywhere else in this system, and inventing an id for it here would
     make a sixteenth name that has to agree with fifteen others. */
  /* ---- AND IT IS NOT NAMED AFTER A GAME, BECAUSE IT IS NOT ONE ----
     This card said WAVE DEFENCE and that was wrong, including on the day I
     wrote it. It leads to the plain "earth" room, and a room with no game in
     its name runs THE PLACE'S OWN GAME, which is whichever published Earth
     game the room happens to receive first. Only a place with no published
     game at all falls back to Wave Defence. So on the live table this card
     has never delivered what it promised: it gave Shakedown, and the moment
     a game whose id sorts earlier was added it silently began giving that
     one instead.

     The honest label is what the card actually DOES: it puts you in the
     shared room, the one you land in if you never open this screen, which is
     where everyone who has not chosen is already fighting. That is a real
     and useful thing to offer and it is the only card here that offers it.

     It deliberately does NOT try to name the game that room is running.
     Working that out client-side would mean reproducing the room's selection
     rule here, and two copies of a rule that must agree, with nothing making
     them, is the fault this file has already been bitten by twice. */
  const builtIn: Omit<GameCard, "id"> & { id: string | null } = {
    id: null, name: "THE MAIN FIGHT", place: "earth", crew: "multiplayer",
  };
  const all: Array<Omit<GameCard, "id"> & { id: string | null }> = [builtIn, ...list];

  return (
    <div className="orbit-card orbit-picker">
      <h2>CHOOSE A GAME</h2>
      {cards === null ? (
        <p>Finding the games…</p>
      ) : (
        <>
          {failed ? <p className="orbit-picker-note">Could not reach the game list. The one below always works.</p> : null}
          <div className="orbit-picker-grid">
            {all.map((c) => (
              <button type="button" key={c.id ?? "built-in"}
                className={"orbit-picker-card"
                  + (chosen && chosen(c.place) === c.id ? " orbit-picker-on" : "")}
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
                {c.id === null ? (
                  <span className="orbit-picker-note orbit-picker-sub">
                    whatever Earth is running, with everyone who has not chosen
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {list.length === 0 ? <p className="orbit-picker-note">No games are published yet, so the built-in is the only one.</p> : null}
        </>
      )}
      {onCancel ? <button type="button" onClick={onCancel}>BACK</button> : null}
    </div>
  );
}
