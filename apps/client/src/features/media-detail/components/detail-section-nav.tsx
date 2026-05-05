import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

export type DetailSection = {
  id: string;
  label: string;
  count?: number;
};

type Props = {
  sections: readonly DetailSection[];
  activeId: string;
  onJump: (id: string) => void;
};

export function DetailSectionNav({ sections, activeId, onJump }: Props) {
  return (
    <nav
      aria-label={m.media_detail_section_nav_label()}
      className="sticky top-19 z-15 mb-8 flex justify-center px-6 pt-2.5 sm:px-8"
    >
      <div className="w-full max-w-[1400px] rounded-2xl bg-card/55 p-1 outline outline-1 outline-offset-[-1px] outline-border shadow-[0_1px_0_0_oklch(1_0_0/0.03),0_8px_24px_-12px_oklch(0_0_0/0.5)] [backdrop-filter:blur(18px)_saturate(1.4)] supports-backdrop-filter:bg-card/55">
        <div className="row-track flex items-center gap-6 overflow-x-auto rounded-xl bg-popover/60 px-3.5 shadow-[0_1px_0_0_oklch(1_0_0/0.04),0_4px_12px_-6px_oklch(0_0_0/0.4)] [backdrop-filter:blur(14px)_saturate(1.3)]">
          {sections.map((section) => {
            const isActive = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onJump(section.id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "group/section relative shrink-0 cursor-pointer border-0 bg-transparent py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
                )}
              >
                <span>{section.label}</span>
                {section.count !== undefined ? (
                  <span className="ms-1.5 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                    {section.count}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 bottom-0.5 h-0.5 origin-center bg-foreground transition-transform duration-220 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
                    isActive ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
