// fallow-ignore-file complexity
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * A bordered surface used by every settings sub-page. Wraps `<Card>` styling
 * with row-based separators so multiple `SettingsCardRow`s read as a
 * connected group rather than independent rectangles.
 */
export function SettingsCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-card"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card text-sm text-card-foreground shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

interface SettingsCardRowProps {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  align?: "center" | "top";
  borderTop?: boolean;
  /** Visual treatment for label tone — e.g. red on the danger-zone card. */
  tone?: "default" | "destructive";
  className?: string;
}

/**
 * Two-column layout used inside a `SettingsCard` for "label + control" rows.
 * Stacks vertically below the `sm` breakpoint so cards stay tap-friendly on
 * narrow screens.
 */
export function SettingsCardRow({
  label,
  hint,
  children,
  align = "center",
  borderTop = false,
  tone = "default",
  className,
}: SettingsCardRowProps) {
  return (
    <div
      className={cn(
        "grid gap-3 px-5 py-5 sm:grid-cols-[minmax(140px,200px)_minmax(0,1fr)] sm:gap-6 sm:px-6",
        align === "top" ? "items-start" : "sm:items-center",
        borderTop && "border-t border-border",
        className,
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm font-medium",
            tone === "destructive" ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface SettingsCardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  count?: number;
  className?: string;
}

/**
 * Section header for a `SettingsCard`. Reads as a card "title bar" with an
 * optional inline action slot (e.g. filter buttons or an "Add" CTA).
 */
export function SettingsCardHeader({
  title,
  description,
  action,
  count,
  className,
}: SettingsCardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-4 border-b border-border px-5 py-4 sm:px-6",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {typeof count === "number" ? (
            <span className="font-mono text-xs text-muted-foreground">{count}</span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A compact icon-led row used by destructive cards (Export, Delete account)
 * where the icon, title, description, and action sit on a single line on
 * desktop and stack on mobile.
 */
export function SettingsActionRow({
  icon,
  title,
  description,
  action,
  destructive,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
  destructive?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6", className)}>
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          destructive
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border bg-muted text-foreground",
        )}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-medium",
            destructive ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </div>
        <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
