import { m } from "@/paraglide/messages";
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
          {m.diagnostics_tab_errors()}
          {errorCount > 0 ? (
            <Badge variant="destructive" className="ms-1.5">
              {errorCount}
            </Badge>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="performance">{m.diagnostics_tab_performance()}</TabsTrigger>
      </TabsList>
      <div className="flex items-center gap-2 pb-2">
        <span className="hidden font-mono text-xs text-muted-foreground/80 md:inline">
          {m.diagnostics_auto_refresh()}
        </span>
        <Badge variant="outline" className="hidden font-mono text-muted-foreground sm:inline-flex">
          {m.diagnostics_read_only()}
        </Badge>
        <RetentionPopover />
      </div>
    </div>
  );
}
