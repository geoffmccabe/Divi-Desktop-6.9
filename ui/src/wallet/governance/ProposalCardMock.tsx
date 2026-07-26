// A single mock proposal card so downloaders can picture the real thing:
// title, requested amount, a 4-milestone bar with the first one done, and an
// illustrative tally. All values are hardcoded examples, nothing is live.

export function ProposalCardMock() {
  return (
    <div className="gov-card">
      <div className="gov-card-top">
        <span className="gov-card-title">Fund a Divi mobile staking widget</span>
        <span className="gov-example-tag">Example</span>
      </div>

      <div className="gov-card-amount-row">
        <span className="wl-note">Requested</span>
        <span className="gov-card-amount">12,000 DIVI</span>
      </div>

      <div>
        <div className="gov-miles">
          <div className="gov-mile gov-mile-done" />
          <div className="gov-mile" />
          <div className="gov-mile" />
          <div className="gov-mile" />
        </div>
        <div className="gov-mile-labels">
          <span>Milestone 1 shipped</span>
          <span>4 milestones, 25% each</span>
        </div>
      </div>

      <div className="gov-tally">
        <span>In favor</span>
        <span className="gov-tally-bar">
          <span className="gov-tally-fill" style={{ width: "61.5%" }} />
        </span>
        <span>
          <strong>8</strong> / 13
        </span>
      </div>
    </div>
  );
}
