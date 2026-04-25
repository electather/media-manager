import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { TriangleAlertIcon, Logs } from "lucide-react";
import type { JobRunSummary, JobHandle } from "@ent-mcp/shared/jobs";
import { LogViewerFilterable, type LogEntry } from "@/components/log-viewer";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export function RunDetailDrawer({
  run,
  job,
  onClose,
}: {
  run: JobRunSummary | null;
  job: JobHandle | null;
  onClose: () => void;
}) {
  return (
    <Drawer open={!!run} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="h-[85vh] max-h-[85vh] flex flex-col rounded-t-xl bg-background border-border">
        <DrawerHeader className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex flex-col gap-1 text-left">
            <DrawerTitle className="font-mono text-base truncate">Run: {run?.id}</DrawerTitle>
            <span className="text-sm text-muted-foreground font-mono">{job?.id}</span>
          </div>
          {run && (
            <Badge variant="secondary" className="font-mono uppercase text-xs">
              {run.status}
            </Badge>
          )}
        </DrawerHeader>

        {run && (
          <Tabs defaultValue="details" className="flex flex-col flex-1 min-h-0">
            <div className="px-6 py-2 border-b border-border shrink-0">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1">
              <TabsContent value="details" className="p-6 m-0 outline-none">
                <div className="flex flex-col gap-4">
                  <div className="overflow-hidden rounded-lg border border-border text-xs">
                    <MetaRow label="Status" value={run.status} />
                    <MetaRow label="Triggered by" value={run.triggeredBy} />
                    <MetaRow label="Request ID" value={run.requestId} mono />
                    {run.scopeKey && <MetaRow label="Target (Scope)" value={run.scopeKey} mono />}
                    <MetaRow label="Started at" value={new Date(run.startedAt).toLocaleString()} />
                    {run.finishedAt && (
                      <MetaRow
                        label="Finished at"
                        value={new Date(run.finishedAt).toLocaleString()}
                      />
                    )}
                    {run.durationMs != null && (
                      <MetaRow label="Duration" value={`${run.durationMs}ms`} />
                    )}
                    {run.errorRecordId && (
                      <MetaRow label="Error Record ID" value={run.errorRecordId} mono />
                    )}
                  </div>
                  {run.result && (
                    <div className="flex flex-col gap-2">
                      <h4 className="text-sm font-medium">Result</h4>
                      <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono text-muted-foreground border border-border">
                        {run.result}
                      </pre>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="logs" className="p-6 m-0 outline-none flex flex-col gap-4">
                {run.logsTruncated && run.logsTruncated > 0 ? (
                  <Alert variant="destructive">
                    <TriangleAlertIcon className="size-4" />
                    <AlertTitle>Logs Truncated</AlertTitle>
                    <AlertDescription>
                      {run.logsTruncated} log entries were truncated because the buffer exceeded its
                      limits.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {run.logs ? (
                  (() => {
                    try {
                      const parsed = JSON.parse(run.logs);
                      if (Array.isArray(parsed)) {
                        const entries: LogEntry[] = parsed.map((log) => ({
                          level: log.level,
                          message: log.msg,
                          timestamp: new Date(log.ts).toISOString(),
                          metadata: log.meta,
                        }));
                        return (
                          <div className="border border-border rounded-lg overflow-hidden shadow-sm">
                            <LogViewerFilterable entries={entries} maxHeight={500} />
                          </div>
                        );
                      }
                      return (
                        <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono text-muted-foreground border border-border">
                          {run.logs}
                        </pre>
                      );
                    } catch {
                      return (
                        <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs font-mono text-muted-foreground border border-border">
                          {run.logs}
                        </pre>
                      );
                    }
                  })()
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Logs />
                      </EmptyMedia>
                      <EmptyTitle>No Logs captured</EmptyTitle>
                      <EmptyDescription>This job run has no logs.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DrawerContent>
    </Drawer>
  );
}
