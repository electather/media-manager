import type { LucideIcon } from "lucide-react";

interface Props {
  /** Icon component rendered in the tile. The caller picks the icon so error
   *  and empty states stay visually distinct. */
  icon: LucideIcon;
  title: string;
  body: string;
  children?: React.ReactNode;
}

/** Centred empty/error state shared by both diagnostics tables. The icon tile,
 *  title, body, and optional action slot are identical between the two
 *  surfaces, so they share one component. */
export function DiagnosticsEmpty({ icon: Icon, title, body, children }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}
