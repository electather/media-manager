import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

/**
 * Editorial section heading primitives. Used by row titles, in-page section
 * heads, and the library page H1. Pick the visual scale via the shared
 * `size` variant: `default` for rows + section heads, `page` for hero-style
 * page titles.
 */

const sectionHeadVariants = cva("flex flex-wrap items-end justify-between gap-4", {
  variants: {
    size: {
      default: "mb-5",
      page: "gap-8 pt-8 pb-7",
    },
  },
  defaultVariants: { size: "default" },
});

interface SectionHeadProps
  extends ComponentProps<"div">, VariantProps<typeof sectionHeadVariants> {}

function SectionHead({ className, size, ...props }: SectionHeadProps) {
  return (
    <div
      data-slot="section-head"
      data-size={size ?? "default"}
      className={cn(sectionHeadVariants({ size }), className)}
      {...props}
    />
  );
}

function SectionHeadHeading({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="section-head-heading" className={cn("min-w-0", className)} {...props} />;
}

const sectionHeadEyebrowVariants = cva("font-mono uppercase text-primary", {
  variants: {
    size: {
      default: "mb-1.5 text-[11px] tracking-[0.16em]",
      page: "mb-3 text-[11px] tracking-[0.18em]",
    },
  },
  defaultVariants: { size: "default" },
});

interface SectionHeadEyebrowProps
  extends ComponentProps<"div">, VariantProps<typeof sectionHeadEyebrowVariants> {}

function SectionHeadEyebrow({ className, size, ...props }: SectionHeadEyebrowProps) {
  return (
    <div
      data-slot="section-head-eyebrow"
      data-size={size ?? "default"}
      className={cn(sectionHeadEyebrowVariants({ size }), className)}
      {...props}
    />
  );
}

const sectionHeadTitleVariants = cva("m-0 flex items-baseline text-foreground", {
  variants: {
    size: {
      default: "gap-2.5 text-[26px] font-semibold leading-[1.05] tracking-[-0.02em]",
      page: "gap-4 text-[clamp(44px,6vw,72px)] font-bold leading-[0.96] tracking-[-0.035em]",
    },
  },
  defaultVariants: { size: "default" },
});

interface SectionHeadTitleProps
  extends ComponentProps<"h2">, VariantProps<typeof sectionHeadTitleVariants> {
  as?: "h1" | "h2" | "h3";
}

function SectionHeadTitle({ className, size, as: Tag = "h2", ...props }: SectionHeadTitleProps) {
  return (
    <Tag
      data-slot="section-head-title"
      data-size={size ?? "default"}
      className={cn(sectionHeadTitleVariants({ size }), className)}
      {...props}
    />
  );
}

const sectionHeadCountVariants = cva("font-mono text-muted-foreground/70 tabular-nums", {
  variants: {
    size: {
      default: "text-sm font-medium tracking-[0.04em]",
      page: "text-[0.36em] font-medium tracking-[-0.02em]",
    },
  },
  defaultVariants: { size: "default" },
});

interface SectionHeadCountProps
  extends ComponentProps<"span">, VariantProps<typeof sectionHeadCountVariants> {
  value: number;
}

function SectionHeadCount({ className, size, value, ...props }: SectionHeadCountProps) {
  return (
    <span
      data-slot="section-head-count"
      data-size={size ?? "default"}
      className={cn(sectionHeadCountVariants({ size }), className)}
      {...props}
    >
      {String(value).padStart(2, "0")}
    </span>
  );
}

function SectionHeadActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="section-head-actions"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  );
}

export {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
};
