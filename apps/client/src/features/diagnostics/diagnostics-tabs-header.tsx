import { Badge } from "@/shared/ui/badge";
import { TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { RetentionPopover } from "./retention-popover";

interface Props {
  errorCount: number;
}

export function DiagnosticsTabsHeader({ errorCount }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <TabsList variant="line">
        <TabsTrigger value="errors">
          Errors
          {errorCount > 0 ? (
            <Badge variant="destructive" className="ml-1.5">
              {errorCount}
            </Badge>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
      </TabsList>
      <div className="flex items-center gap-2 pb-2">
        <span className="hidden font-mono text-xs text-muted-foreground/80 md:inline">
          auto-refresh · 30s
        </span>
        <Badge variant="outline" className="hidden font-mono text-muted-foreground sm:inline-flex">
          read-only
        </Badge>
        <RetentionPopover />
      </div>
    </div>
  );
}
