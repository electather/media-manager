import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

type LogoProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Accessible label. When omitted the logo is treated as decorative. */
  "aria-label"?: string;
};

/**
 * Brand mark, served as two static SVG assets so the browser can cache them
 * and skip the React reconciliation cost of mounting the 14-path inline tree
 * on every parent render. Light/dark variants swap via the document `dark`
 * class set by `public/theme-init.js`.
 */
export function Logo({ className, "aria-label": ariaLabel, ...rest }: LogoProps) {
  const labelled = typeof ariaLabel === "string" && ariaLabel.length > 0;
  return (
    <span
      {...rest}
      className={cn("inline-block", className)}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? ariaLabel : undefined}
    >
      <img
        src="/logo-light.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="block size-full dark:hidden"
      />
      <img
        src="/logo-dark.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="hidden size-full dark:block"
      />
    </span>
  );
}
