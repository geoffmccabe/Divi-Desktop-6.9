// Divi Collectibles (NFDs). The mint/view/transfer internals are built by the
// NFD workstream (see Divi-Blockchain_6.9/docs/DIVI-COLLECTIBLES-NFT-BRIEF.md);
// this panel reserves the place in the wallet and explains the feature so the
// nav item is real and on-brand until that work lands.

export function CollectiblesPanel() {
  return (
    <div className="collectibles">
      <section className="ts-section">
        <h3 className="ts-head">Divi Collectibles</h3>
        <p className="wl-note">
          Collectibles you actually own — not just a public link anyone can copy. Each Divi Collectible
          (an <strong>NFD</strong>, Non-Fungible-DIVI) keeps its real content <strong>encrypted</strong> on
          permanent storage, while its ownership is anchored on the Divi blockchain. Only the owner can
          unlock the content; the chain proves who holds it.
        </p>

        <ul className="coll-points">
          <li>Mint a collectible from a file — the content is encrypted before it ever leaves your machine.</li>
          <li>View and unlock the collectibles you own, right here in the wallet.</li>
          <li>Transfer ownership to another Divi address.</li>
        </ul>

        <div className="coll-soon">
          <span className="coll-badge">Coming soon</span>
          <span className="wl-note">
            Arriving with the Divi Collectibles release. Proof of Existence (the same anchoring technology,
            for files) is already available in the menu on the left.
          </span>
        </div>
      </section>
    </div>
  );
}
