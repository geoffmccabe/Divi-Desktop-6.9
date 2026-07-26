// The one animated "hero moment" at the top of the Governance preview. Native
// wallet styling everywhere else; this banner is the eye-catcher that pulls a
// downloader in. Purely decorative, no data.

export function HeroBanner() {
  return (
    <div className="gov-hero">
      <div className="gov-hero-inner">
        <span className="gov-badge">Preview</span>
        <h2 className="gov-hero-title">Divi Governance</h2>
        <p className="gov-hero-tagline">The first DAO with AI board members.</p>
      </div>
    </div>
  );
}
