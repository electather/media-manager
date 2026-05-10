import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

function ToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const toggleGroupItemVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        chip: cn(
          "rounded-md border border-border bg-transparent px-2.5 py-1 text-muted-foreground",
          "hover:border-input hover:text-foreground",
          "data-pressed:border-input data-pressed:bg-muted data-pressed:text-foreground",
        ),
        segmented:
          "border-r border-border bg-transparent px-3 py-1 text-muted-foreground last:border-r-0 hover:bg-muted/60 data-pressed:bg-muted data-pressed:text-foreground",
      },
    },
    defaultVariants: {
      variant: "chip",
    },
  },
);

interface ToggleGroupItemProps<Value extends string>
  extends TogglePrimitive.Props<Value>, VariantProps<typeof toggleGroupItemVariants> {}

function ToggleGroupItem<Value extends string>({
  className,
  variant,
  ...props
}: ToggleGroupItemProps<Value>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ variant }), className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants };
