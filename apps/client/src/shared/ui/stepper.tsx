import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

export type StepState = "complete" | "current" | "upcoming";

interface StepperContextValue {
  current: number;
}

interface StepperItemContextValue {
  index: number;
  state: StepState;
}

const StepperContext = createContext<StepperContextValue | null>(null);
const StepperItemContext = createContext<StepperItemContextValue | null>(null);

function useStepperContext(component: string): StepperContextValue {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error(`${component} must be rendered inside <Stepper>`);
  return ctx;
}

function useStepperItemContext(component: string): StepperItemContextValue {
  const ctx = useContext(StepperItemContext);
  if (!ctx) throw new Error(`${component} must be rendered inside <StepperItem>`);
  return ctx;
}

export interface StepperProps extends ComponentProps<"ol"> {
  /** Index of the active step. Steps before are "complete", steps after are "upcoming". */
  current: number;
}

function Stepper({ current, className, children, ...props }: StepperProps) {
  return (
    <StepperContext value={{ current }}>
      <ol
        data-slot="stepper"
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-6 py-2.5",
          className,
        )}
        {...props}
      >
        {children}
      </ol>
    </StepperContext>
  );
}

export interface StepperItemProps extends Omit<ComponentProps<"li">, "children"> {
  /** Zero-based position used to compute state against `Stepper.current`. */
  index: number;
  children?: ReactNode;
}

function StepperItem({ index, className, children, ...props }: StepperItemProps) {
  const { current } = useStepperContext("StepperItem");
  const state: StepState =
    index < current ? "complete" : index === current ? "current" : "upcoming";
  return (
    <StepperItemContext value={{ index, state }}>
      <li
        data-slot="stepper-item"
        data-state={state}
        aria-current={state === "current" ? "step" : undefined}
        className={cn(
          "inline-flex items-center gap-2 font-mono text-[11px] tracking-wider uppercase",
          "data-[state=current]:text-foreground",
          "data-[state=complete]:text-muted-foreground",
          "data-[state=upcoming]:text-muted-foreground/60",
          className,
        )}
        {...props}
      >
        {children}
      </li>
    </StepperItemContext>
  );
}

export interface StepperIndicatorProps extends ComponentProps<"span"> {
  /** Override the default content (number when active/upcoming, check when complete). */
  children?: ReactNode;
}

function StepperIndicator({ className, children, ...props }: StepperIndicatorProps) {
  const { index, state } = useStepperItemContext("StepperIndicator");
  return (
    <span
      data-slot="stepper-indicator"
      data-state={state}
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-full border text-[10px]",
        "data-[state=current]:border-transparent data-[state=current]:bg-primary data-[state=current]:text-primary-foreground",
        "data-[state=complete]:border-success/40 data-[state=complete]:bg-success/15 data-[state=complete]:text-success",
        "data-[state=upcoming]:border-border data-[state=upcoming]:bg-muted data-[state=upcoming]:text-muted-foreground/70",
        className,
      )}
      {...props}
    >
      {children ?? (state === "complete" ? <CheckIcon className="size-3" /> : index + 1)}
    </span>
  );
}

function StepperLabel({ className, ...props }: ComponentProps<"span">) {
  const { state } = useStepperItemContext("StepperLabel");
  return <span data-slot="stepper-label" data-state={state} className={cn(className)} {...props} />;
}

function StepperSeparator({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="stepper-separator"
      aria-hidden="true"
      className={cn("h-px max-w-10 flex-1 bg-border", className)}
      {...props}
    />
  );
}

/**
 * Reads the resolved state of the enclosing `<StepperItem>`. Use this to build
 * fully custom indicators or labels that need to vary by step state.
 *
 * @throws if called outside a `<StepperItem>`.
 */
function useStepperItem(): StepperItemContextValue {
  return useStepperItemContext("useStepperItem");
}

export { Stepper, StepperItem, StepperIndicator, StepperLabel, StepperSeparator, useStepperItem };
