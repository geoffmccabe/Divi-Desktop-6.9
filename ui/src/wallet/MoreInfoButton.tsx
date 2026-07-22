// The "MORE INFO" capsule that opens the Proof of Existence explainer modal.
// Shared so the same pill can sit in two places (after the intro paragraph and
// under the deepfake-defense section) without duplicating markup or wiring.

export function MoreInfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="poe-moreinfo" onClick={onClick}>
      MORE INFO
    </button>
  );
}
