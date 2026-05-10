import { cn } from "@/shared/lib/utils";

interface NameGlyphProps {
  name: string;
  className?: string;
}

function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function nameToMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
  }
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/**
 * Monogram tile derived entirely from a name — hue and initials are computed
 * so each entry stays visually distinct without manual configuration.
 */
export function NameGlyph({ name, className }: NameGlyphProps) {
  const hue = nameToHue(name);
  const sideHue = (hue + 30) % 360;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "inline-flex size-10.5 shrink-0 items-center justify-center rounded-2xl font-mono text-base font-semibold tracking-wider",
        className,
      )}
      style={{
        background: `linear-gradient(150deg, oklch(0.30 0.04 ${hue}) 0%, oklch(0.22 0.025 ${sideHue}) 100%)`,
        border: `1px solid oklch(0.40 0.05 ${hue} / 0.7)`,
        color: `oklch(0.92 0.10 ${hue})`,
        boxShadow: "inset 0 1px 0 0 oklch(1 0 0 / 0.06)",
      }}
    >
      {nameToMonogram(name)}
    </div>
  );
}
