import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";

interface CenteredStateProps {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void } | ReactNode;
}

export function CenteredState({ title, body, action }: CenteredStateProps) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[420px] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action ? (
        isActionDescriptor(action) ? (
          <Button size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : (
          action
        )
      ) : null}
    </div>
  );
}

function isActionDescriptor(value: unknown): value is { label: string; onClick: () => void } {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    "onClick" in value &&
    typeof (value as { onClick: unknown }).onClick === "function"
  );
}
