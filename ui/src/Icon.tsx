// Renders --icon-<name> as a mask over the current text color. The shape comes
// entirely from the CSS variable, so skins swap icons with zero code changes.
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      className="ic"
      aria-hidden
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `var(--icon-${name})`,
        maskImage: `var(--icon-${name})`,
      }}
    />
  );
}
