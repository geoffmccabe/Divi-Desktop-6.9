// A one-shot handoff so the Contacts panel can prefill the Send panel. The
// Contacts "Send" button stashes a recipient here and fires dd69:sendto; Shell
// switches to the Send view, and SendPanel takes() the target on mount.

let pending: { address: string; name?: string } | null = null;

export function setSendTarget(address: string, name?: string) {
  pending = { address, name };
  window.dispatchEvent(new CustomEvent("dd69:sendto"));
}

// Returns the pending recipient once, then clears it.
export function takeSendTarget(): { address: string; name?: string } | null {
  const t = pending;
  pending = null;
  return t;
}
