import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { CopyButton } from "./copy-button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import { cn } from "@/shared/lib/utils";

type ErrorPageTone = "info" | "warn" | "danger";

// Two stacked pseudo-element layers paint the stage:
//   ::before — soft radial ambient wash, color set per tone via the
//   `--error-page-ambient` custom property (CVA tone variants below).
//   ::after  — fine dotted grid, masked to fade out at the edges so the
//   pattern reads as ambient texture rather than a hard backdrop.
const errorPageVariants = cva(
  cn(
    "relative isolate grid min-h-[calc(100dvh-var(--header-height,0px))] place-items-center px-8 py-12 sm:px-12 sm:py-16",
    "before:pointer-events-none before:absolute before:inset-0 before:-z-20 before:transition-[background] before:duration-[360ms]",
    "before:bg-[radial-gradient(60%_50%_at_50%_38%,var(--error-page-ambient),transparent_70%)]",
    "after:pointer-events-none after:absolute after:inset-0 after:-z-10",
    "after:bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklab,var(--muted-foreground)_30%,transparent)_1px,transparent_0)] after:bg-[length:28px_28px]",
    "after:[mask-image:radial-gradient(ellipse_80%_60%_at_50%_45%,black_0%,transparent_75%)] after:[-webkit-mask-image:radial-gradient(ellipse_80%_60%_at_50%_45%,black_0%,transparent_75%)]",
  ),
  {
    variants: {
      tone: {
        info: "[--error-page-ambient:color-mix(in_oklab,var(--ring)_14%,transparent)]",
        warn: "[--error-page-ambient:color-mix(in_oklab,var(--primary)_18%,transparent)]",
        danger: "[--error-page-ambient:color-mix(in_oklab,var(--destructive)_20%,transparent)]",
      },
    },
    defaultVariants: { tone: "danger" },
  },
);

interface ErrorPageProps
  extends Omit<React.ComponentProps<"section">, "color">, VariantProps<typeof errorPageVariants> {}

function ErrorPage({ className, tone, ...props }: ErrorPageProps) {
  return (
    <section
      data-slot="error-page"
      data-tone={tone ?? "danger"}
      className={cn(errorPageVariants({ tone }), className)}
      {...props}
    />
  );
}

function ErrorPageFrame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="error-page-frame"
      role="alert"
      aria-live="polite"
      className={cn("flex w-full max-w-3xl flex-col gap-7", className)}
      {...props}
    />
  );
}

interface ErrorPageHeadlineProps extends React.ComponentProps<"div"> {
  /** The big mono code (e.g. "404", "500", "ERR_FEED"). */
  code: React.ReactNode;
  /** Mono eyebrow above the headline (e.g. "// GET /api/v1/feed/home"). */
  eyebrow?: React.ReactNode;
}

function ErrorPageHeadline({
  className,
  code,
  eyebrow,
  children,
  ...props
}: ErrorPageHeadlineProps) {
  return (
    <div
      data-slot="error-page-headline"
      className={cn("grid items-stretch gap-4 sm:grid-cols-[auto_1fr] sm:gap-6", className)}
      {...props}
    >
      <div
        aria-hidden="true"
        className="relative font-mono text-[clamp(64px,14vw,132px)] leading-none font-semibold tracking-[-0.04em]"
      >
        <span className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-transparent">
          {code}
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-55 bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--primary)_80%,transparent),transparent)] motion-safe:animate-[error-page-scan_4.2s_ease-in-out_infinite] motion-reduce:opacity-0"
        />
      </div>
      <div className="flex min-w-0 flex-col justify-end gap-1 pb-1">
        {eyebrow ? (
          <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
          {children}
        </h1>
      </div>
    </div>
  );
}

function ErrorPageDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="error-page-description"
      className={cn(
        "max-w-[60ch] text-base leading-relaxed text-pretty text-muted-foreground",
        "[&_code]:rounded-md [&_code]:border [&_code]:border-border [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ErrorPageActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="error-page-actions"
      className={cn("flex flex-wrap items-center gap-2.5", className)}
      {...props}
    />
  );
}

interface ErrorPageDetailRow {
  /** Stable key — used as the row label in monospace caps. */
  label: string;
  /** Display value rendered into the row. */
  value: React.ReactNode;
  /** Optional override for what gets put on the clipboard; defaults to `value` if it is a string. */
  copyValue?: string;
}

interface ErrorPageDetailsProps {
  rows: readonly ErrorPageDetailRow[];
  /** Short reference id rendered next to the title — e.g. the request id prefix. */
  reference?: string;
  /** Optional pre-formatted stack/trace block shown beneath the rows when expanded. */
  trace?: React.ReactNode;
  /** Localized title for the trigger; defaults to "Technical details" when omitted. */
  title?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

function ErrorPageDetails({
  rows,
  reference,
  trace,
  title = "Technical details",
  defaultOpen = false,
  className,
}: ErrorPageDetailsProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div
        data-slot="error-page-details"
        className={cn(
          "error-surface overflow-hidden rounded-xl border border-border transition-colors hover:border-input",
          className,
        )}
      >
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="group h-auto w-full justify-between rounded-none px-3.5 py-3 text-start text-sm font-medium hover:bg-muted/40"
            />
          }
        >
          <span className="inline-flex items-center gap-2.5 text-sm font-medium text-foreground">
            <span>{title}</span>
            {reference ? (
              <span className="font-mono text-xs text-muted-foreground">· {reference}</span>
            ) : null}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border bg-background/40">
          <dl className="divide-y divide-border">
            {/* fallow-ignore-next-line complexity */}
            {rows.map((row) => {
              const copyValue = row.copyValue ?? (typeof row.value === "string" ? row.value : null);
              return (
                <div
                  key={row.label}
                  className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 font-mono text-xs"
                >
                  <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">
                    {row.label}
                  </dt>
                  <dd className="truncate text-foreground" title={copyValue ?? undefined}>
                    {row.value}
                  </dd>
                  {copyValue ? (
                    <CopyButton value={copyValue} size="icon-xs" iconClassName="size-3" />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </dl>
          {trace ? (
            <pre className="overflow-x-auto border-t border-border bg-muted/40 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {trace}
            </pre>
          ) : null}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ErrorPageHelp({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="error-page-help"
      className={cn(
        "flex flex-wrap gap-x-5 gap-y-3 border-t border-dashed border-border pt-5 text-sm",
        "[&_a]:inline-flex [&_a]:items-center [&_a]:gap-2 [&_a]:text-muted-foreground [&_a]:transition-colors [&_a:hover]:text-foreground",
        "[&_a_svg]:size-3.5 [&_a_svg]:text-muted-foreground/70 [&_a:hover_svg]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

export {
  ErrorPage,
  ErrorPageActions,
  ErrorPageDescription,
  ErrorPageDetails,
  ErrorPageFrame,
  ErrorPageHeadline,
  ErrorPageHelp,
  type ErrorPageDetailRow,
  type ErrorPageTone,
};
