// The centerpiece: the 13 voters that decide every proposal, grouped as
// 7 board / 4 community teams / 2 AI. Placeholder team names (Team 1..4) until
// Geoff supplies the real ones. Illustrative only.

const TEAMS = ["Team 1", "Team 2", "Team 3", "Team 4"];

export function VoterGrid() {
  return (
    <div className="gov-voters">
      <div className="gov-group">
        <span className="gov-group-label">7 Board — elected experts</span>
        <div className="gov-seats">
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className="gov-seat gov-seat-board">
              Board {i + 1}
            </span>
          ))}
        </div>
      </div>

      <div className="gov-group">
        <span className="gov-group-label">4 Community teams — vote your stake</span>
        <div className="gov-seats">
          {TEAMS.map((t) => (
            <span key={t} className="gov-seat gov-seat-team">
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="gov-group">
        <span className="gov-group-label">2 AI voters — always informed</span>
        <div className="gov-seats">
          <span className="gov-seat gov-seat-ai">AI Voter 1</span>
          <span className="gov-seat gov-seat-ai">AI Voter 2</span>
        </div>
      </div>

      <div className="gov-quorum">
        <strong>7 of 13</strong> votes needed to pass a proposal.
      </div>
    </div>
  );
}
