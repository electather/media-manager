import type { ReactNode } from "react";

interface SectionHeadProps {
  eyebrow?: string;
  title: string;
  count?: number;
  accessory?: ReactNode;
}

/**
 * Editorial section header used across the watchlist page. The accessory slot
 * sits flush-right on the title line — pass scroll arrows, badge counters, or
 * action buttons depending on the section's affordance.
 */
export function SectionHead({ eyebrow, title, count, accessory }: SectionHeadProps) {
  const padded = count != null ? String(count).padStart(2, "0") : null;
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <div className="mb-1.5 font-mono text-[11px] tracking-[0.16em] text-primary uppercase">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-2xl leading-[1.05] font-semibold tracking-tight text-foreground">
          {title}
          {padded ? (
            <span className="ms-2.5 font-mono text-sm font-medium tracking-[0.04em] text-muted-foreground/70">
              {padded}
            </span>
          ) : null}
        </h2>
      </div>
      {accessory}
    </div>
  );
}
