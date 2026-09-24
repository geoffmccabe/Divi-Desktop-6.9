import { useCallback, useEffect, useState } from "react";
import { nodeReachability, setNodeUpnp, type Reachability } from "./api";

// ── "Can anyone reach my node?" ────────────────────────────────────────────
//
// A node that only dials OUT works perfectly as a wallet and stakes perfectly
// well, but nothing can connect to it, so no other node lists it and its
// address never spreads. It is a full participant that is invisible.
//
// Every DD69 install was in that state and the app never said a word about it.
// Someone set up a node in Nigeria, watched it stake, and could not understand
// why it never appeared on the map. Nothing was broken. Nothing had told him.

export function NetworkReachPanel() {
  const [r, setR] = useState<Reachability | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const load = useCallback(() => {
    nodeReachability()
      .then(setR)
      .catch(() => setR(null));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = async (on: boolean) => {
    setSaving(true);
    setErr(null);
    try {
      await setNodeUpnp(on);
      setChanged(true);
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!r || !r.known) {
    return <p className="wl-note">Checking whether the network can reach your node…</p>;
  }

  return (
    <div className="reach-panel">
      <div className={"reach-status " + (r.reachable || r.helpers.length ? "reach-ok" : "reach-hidden")}>
        <strong>
          {r.reachable
            ? "Other nodes can reach you"
            : r.helpers.length
              ? `Reachable through ${r.helpers.length} helper node${r.helpers.length === 1 ? "" : "s"}`
              : "Other nodes cannot reach you"}
        </strong>
        <p className="wl-note">
          {r.reachable ? (
            <>
              Your node accepts incoming connections, so it appears on the
              network like any other full node.
            </>
          ) : r.helpers.length ? (
            <>
              Your router blocks incoming connections, so other nodes reach you
              through {r.helpers.join(", ")}. Nothing to set up; your node
              chose them and will choose others if they go away.
            </>
          ) : (
            <>
              Your node dials out to {r.outbound} peer{r.outbound === 1 ? "" : "s"} but
              nothing has dialled in. It still syncs and stakes normally, but no
              other node can list it, so it stays invisible on the network map.
            </>
          )}
        </p>
      </div>

      <div className="reach-facts">
        <div><span>Connections you made</span><b>{r.outbound}</b></div>
        <div><span>Connections made to you</span><b>{r.inbound}</b></div>
        {r.relaySupported && <div><span>Home nodes you are helping</span><b>{r.helping}</b></div>}
        <div><span>Peer port</span><b>{r.port}</b></div>
        {r.addresses.length > 0 && (
          <div><span>Your public address</span><b>{r.addresses.join(", ")}</b></div>
        )}
      </div>

      <label className="reach-toggle">
        <input
          type="checkbox"
          checked={r.upnp}
          disabled={saving}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          <strong>Let my node be reached from outside</strong>
          <em>
            Asks your router to open port {r.port} automatically, so other nodes
            can connect to you. This is how a full node normally behaves. Turn it
            off if you would rather not accept incoming connections.
          </em>
        </span>
      </label>

      {changed && (
        <p className="wl-note reach-restart">
          Saved. This takes effect the next time your node restarts — we do not
          restart it for you, since that would interrupt staking.
        </p>
      )}
      {err && <p className="wl-note reach-err">{err}</p>}

      {!r.reachable && r.upnp && (
        <div className="reach-help">
          <strong>Still not reachable?</strong>
          <p className="wl-note">
            Some routers refuse the automatic request, and some internet
            providers put customers behind a shared connection where no port can
            be opened at all — this is common on mobile networks. If your router
            has a "port forwarding" section, forward <b>TCP port {r.port}</b> to
            this computer.
          </p>
          <p className="wl-note">
            Only forward {r.port}. Never forward 51473, which is the private
            control port for your wallet.
          </p>
        </div>
      )}
    </div>
  );
}
