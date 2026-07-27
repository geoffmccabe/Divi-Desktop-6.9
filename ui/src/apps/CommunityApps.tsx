import { useEffect, useState } from "react";
import "./apps.css";
import { MediaCard } from "./MediaCard";
import { loadCatalog, priceLabel, type Catalog, type CatalogEntry } from "./catalog";
import { AppHost } from "./AppHost";

// The Community Apps store.
//
// Browsing is entirely local: every thumbnail ships inside its app's signed
// bundle, so opening this panel makes no network request and leaks nothing about
// what a user is looking at.

export function CommunityApps() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [running, setRunning] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((c) => alive && setCatalog(c))
      .catch(() => alive && setCatalog({ entries: [], error: "Could not reach the app store." }));
    return () => { alive = false; };
  }, []);

  if (running) {
    return <AppHost entry={running} onExit={() => setRunning(null)} />;
  }

  if (!catalog) {
    return <div className="ca"><p className="ca-count">Loading apps…</p></div>;
  }

  return (
    <div className="ca">
      <div className="ca-head">
        <p className="ca-count">
          {catalog.entries.length === 0
            ? "No apps published yet"
            : `${catalog.entries.length} app${catalog.entries.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {catalog.error && <div className="ca-empty"><p>{catalog.error}</p></div>}

      {!catalog.error && catalog.entries.length === 0 && (
        <div className="ca-empty">
          <h3>Nothing here yet</h3>
          <p>
            Community Apps are small tools built by other people and run inside a
            sandbox, so they can never reach your keys. None have been published
            so far. When they are, they will appear here.
          </p>
        </div>
      )}

      {catalog.entries.length > 0 && (
        <div className="ca-grid">
          {catalog.entries.map((entry) => (
            <AppCard key={entry.manifest.id} entry={entry} onOpen={() => setRunning(entry)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AppCard({ entry, onOpen }: { entry: CatalogEntry; onOpen: () => void }) {
  const m = entry.manifest;
  const price = priceLabel(m);
  const caps = m.permissions.length;
  return (
    <div
      className="ca-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <MediaCard showcase={m.media.showcase} thumbnail={m.media.thumbnail} alt={m.name} />
      <div className="ca-body">
        <span className="ca-name">{m.name}</span>
        <span className="ca-author">by {m.author.name}</span>
        <span className="ca-desc">{m.description}</span>
        <div className="ca-row">
          <span className={`ca-price${price.free ? " ca-price-free" : ""}`}>{price.text}</span>
          <span className="ca-perms">
            {caps === 0 ? "Asks for nothing" : `${caps} permission${caps === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
    </div>
  );
}
