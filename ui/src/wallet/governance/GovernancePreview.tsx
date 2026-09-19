// Governance preview panel. A beautiful, NON-functional walkthrough of what Divi
// Governance will be, so people who download the wallet can see it coming and
// go discuss it. No keys, no daemon calls, no live data — pure presentation.
// Voting, proposals and live tallies arrive in later phases.

import "./governance.css";
import "../multisig/multisig.css";
import { Icon } from "../../Icon";
import { openUrl } from "../api";
import { HeroBanner } from "./HeroBanner";
import { VoterGrid } from "./VoterGrid";
import { ProposalCardMock } from "./ProposalCardMock";
import { TreasuryStrip } from "../multisig/TreasuryStrip";

// Invite link for the existing "Divi Love Project" Telegram group.
const TELEGRAM_URL = "https://t.me/+eivUE-J6EYtjMzIx";

export function GovernancePreview() {
  return (
    <div className="gov">
      <TreasuryStrip />

      <HeroBanner />

      <section className="ts-section">
        <h3 className="ts-head">What it is</h3>
        <p className="wl-note gov-wide">
          A fair, hard-to-capture way for the Divi community to decide which projects get funded
          from a shared DIVI pool. No single group controls it.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">13 voters decide every proposal</h3>
        <VoterGrid />
      </section>

      <section className="ts-section">
        <h3 className="ts-head">How funding works</h3>
        <ol className="gov-steps">
          <li className="gov-step">
            <span className="gov-step-num">1</span>
            <div className="gov-step-body">
              <h4>Submit a proposal</h4>
              <p className="wl-note gov-wide">Anyone can propose a project and request DIVI from the pool.</p>
            </div>
          </li>
          <li className="gov-step">
            <span className="gov-step-num">2</span>
            <div className="gov-step-body">
              <h4>The 13 vote</h4>
              <p className="wl-note gov-wide">
                7 board members, 4 community teams voting their stake, and 2 AI voters. Seven yes
                votes pass it.
              </p>
            </div>
          </li>
          <li className="gov-step">
            <span className="gov-step-num">3</span>
            <div className="gov-step-body">
              <h4>Money follows milestones</h4>
              <p className="wl-note gov-wide">
                Funding is released across up to 4 milestones, 25% at a time. Nothing is paid until
                the first milestone actually ships and works.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Example proposal</h3>
        <ProposalCardMock />
        <span className="wl-note">An illustration. No proposals are live yet.</span>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Your voice</h3>
        <p className="wl-note gov-wide">
          Every staker joins one of four community teams and votes their stake with that team.
          Teams are assigned to start, and you can move to be with friends when there is room. Real
          influence, not just watching.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">The funding pool</h3>
        <p className="wl-note gov-wide">
          Approved projects are paid from a seeded DIVI pool, protected by tight per-proposal and
          per-quarter caps so it can never be drained.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Have questions or ideas?</h3>
        <p className="wl-note gov-wide">
          Governance is being built now. Tell us what you think and help shape it.
        </p>
        <button type="button" className="gov-cta-btn" onClick={() => openUrl(TELEGRAM_URL)}>
          Join the discussion on Telegram
          <Icon name="external" size={16} />
        </button>
      </section>

      <p className="gov-foot">Preview only. Nothing here is live yet, and details may change.</p>
    </div>
  );
}
