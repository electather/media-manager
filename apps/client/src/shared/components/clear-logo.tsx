import { cn } from "@/shared/lib/utils";

export type ClearLogoSize = "sm" | "md" | "lg";

type ClearLogoProps = {
  text: string;
  size?: ClearLogoSize;
  className?: string;
};

const SIZE_TO_FONT_CLAMP: Record<ClearLogoSize, string> = {
  sm: "clamp(11px, 3.4cqw, 18px)",
  md: "clamp(13px, 4.2cqw, 32px)",
  lg: "clamp(20px, 4cqw, 44px)",
};

export function ClearLogo({ text, size = "md", className }: ClearLogoProps) {
  return (
    <div
      className={cn(
        "absolute inset-x-3 bottom-3 z-2 font-mono leading-none tracking-[0.18em] text-white",
        "font-bold drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]",
        className,
      )}
      style={{ fontSize: SIZE_TO_FONT_CLAMP[size] }}
    >
      {text}
    </div>
  );
}
