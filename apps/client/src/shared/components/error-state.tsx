import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlertIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

const errorStateVariants = cva(
  "group/error-state error-surface relative flex border border-border",
  {
    variants: {
      orientation: {
        horizontal: "min-h-33 items-center gap-4 rounded-2xl px-5 py-5",
        vertical: "w-full flex-col items-center gap-4 rounded-3xl px-8 py-12 text-center",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  },
);

function ErrorState({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof errorStateVariants>) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      aria-live="polite"
      data-orientation={orientation ?? "horizontal"}
      className={cn(errorStateVariants({ orientation }), className)}
      {...props}
    />
  );
}

const errorStateMediaVariants = cva(
  "flex shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15 text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: "size-11 [&_svg:not([class*='size-'])]:size-5",
        lg: "size-14 rounded-2xl [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

function ErrorStateMedia({
  className,
  size,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof errorStateMediaVariants>) {
  return (
    <div
      data-slot="error-state-media"
      aria-hidden="true"
      className={cn(errorStateMediaVariants({ size }), className)}
      {...props}
    >
      {children ?? <CircleAlertIcon />}
    </div>
  );
}

function ErrorStateContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="error-state-content"
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1",
        "group-data-[orientation=vertical]/error-state:max-w-md group-data-[orientation=vertical]/error-state:items-center group-data-[orientation=vertical]/error-state:gap-2",
        className,
      )}
      {...props}
    />
  );
}

function ErrorStateTitle({ className, children, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="error-state-title"
      className={cn(
        "font-heading text-sm font-semibold tracking-tight text-balance text-foreground",
        "group-data-[orientation=vertical]/error-state:text-xl",
        className,
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

function ErrorStateDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="error-state-description"
      className={cn(
        "max-w-[56ch] text-xs leading-relaxed text-pretty text-muted-foreground",
        "group-data-[orientation=vertical]/error-state:text-sm/relaxed",
        className,
      )}
      {...props}
    />
  );
}

function ErrorStateDetail({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="error-state-detail"
      className={cn("max-w-md text-xs text-muted-foreground/80", className)}
      {...props}
    />
  );
}

function ErrorStateReference({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="error-state-reference"
      className={cn("font-mono text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function ErrorStateActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="error-state-actions"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2",
        "group-data-[orientation=vertical]/error-state:mt-2 group-data-[orientation=vertical]/error-state:justify-center",
        className,
      )}
      {...props}
    />
  );
}

function ErrorScreen({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="error-screen"
      className={cn("flex min-h-[60vh] w-full items-center justify-center px-6 py-12", className)}
      {...props}
    />
  );
}

export {
  ErrorScreen,
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateDetail,
  ErrorStateMedia,
  ErrorStateReference,
  ErrorStateTitle,
};
