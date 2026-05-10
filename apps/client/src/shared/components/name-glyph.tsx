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
    // words[0] and words[1] are guaranteed to exist and be non-empty after the
    // length guard and filter(Boolean) call above.
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  const word = words[0];
  return word ? word.slice(0, 2).toUpperCase() : "?";
}

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
