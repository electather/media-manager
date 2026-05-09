import type { ReactNode } from "react";

interface SectionHeadProps {
  eyebrow?: string;
  title: string;
  count?: number;
  accessory?: ReactNode;
}

/**
 * Editorial section header: monospace eyebrow line, large title, and an
 * optional zero-padded count badge tucked beside it. `accessory` is
 * right-aligned and used for filter chips, scroll arrows, or status copy.
 */
export function SectionHead({ eyebrow, title, count, accessory }: SectionHeadProps) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="m-0 flex items-baseline gap-2.5 text-[26px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground">
          {title}
          {count != null ? (
            <span className="font-mono text-sm font-medium tracking-[0.04em] text-muted-foreground/70 tabular-nums">
              {String(count).padStart(2, "0")}
            </span>
          ) : null}
        </h2>
      </div>
      {accessory ? <div className="flex items-center gap-2">{accessory}</div> : null}
    </div>
  );
}
