import { cn } from "@/shared/lib/utils";

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const a = h % 360;
  const b = (a + 38) % 360;
  return `linear-gradient(135deg, oklch(0.55 0.13 ${a}), oklch(0.62 0.14 ${b}))`;
}

/**
 * Initials-on-deterministic-gradient avatar used on the Profile settings page.
 * No image upload is needed — the gradient is hashed from the user's display
 * name so it's stable across renders but unique per user.
 */
export function InitialsAvatar({
  name,
  size = 72,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`${name} avatar`}
      className={cn(
        "flex select-none items-center justify-center rounded-full font-semibold text-white shadow-md",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: avatarGradient(name || "?"),
        fontSize: size * 0.35,
        letterSpacing: "0.01em",
      }}
    >
      {nameInitials(name || "?")}
    </div>
  );
}
