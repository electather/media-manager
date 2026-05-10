import { cn } from "@/shared/lib/utils";

interface ClientGlyphProps {
  monogram: string;
  /** OKLCH hue (0-360) used to tint the tile. */
  accentHue: number;
  size?: number;
  className?: string;
}

/**
 * Hand-drawn monogram tile used for authorized MCP clients. The accent hue
 * keeps each client visually distinct without depending on third-party logos.
 */
export function ClientGlyph({ monogram, accentHue, size = 42, className }: ClientGlyphProps) {
  const ch = (monogram || "?").slice(0, 2);
  const sideHue = (accentHue + 30) % 360;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[10px] font-mono font-semibold tracking-wider",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(150deg, oklch(0.30 0.04 ${accentHue}) 0%, oklch(0.22 0.025 ${sideHue}) 100%)`,
        border: `1px solid oklch(0.40 0.05 ${accentHue} / 0.7)`,
        color: `oklch(0.92 0.10 ${accentHue})`,
        boxShadow: "inset 0 1px 0 0 oklch(1 0 0 / 0.06)",
      }}
    >
      {ch}
    </div>
  );
}
