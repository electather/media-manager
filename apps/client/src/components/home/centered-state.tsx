import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CenteredStateProps {
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}

export function CenteredState({ title, body, action, className }: CenteredStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "mx-auto flex w-full max-w-[420px] flex-col items-center gap-3 px-4 py-16 text-center",
        className,
      )}
    >
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
