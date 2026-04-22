import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlayIcon, RefreshCwIcon, CircleCheckIcon } from "lucide-react";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup, Field, FieldLabel, FieldContent } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { UserPicker, ConnectionPicker } from "@/components/pickers";
import type { JobHandle } from "@ent-mcp/shared/jobs";

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export function DynamicTriggerDialog({
  open,
  job,
  onClose,
}: {
  open: boolean;
  job: JobHandle | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!open) {
      setRunId(null);
      setFormData({});
    }
  }, [open]);

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.jobs[":id"].trigger.$post({
        param: { id: job!.id },
        json: Object.keys(formData).length > 0 ? formData : null,
      });
      if (!res.ok) throw new Error("trigger failed");
      return res.json() as Promise<{ runId?: string }>;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      if (data && "runId" in data && data.runId) {
        setRunId(data.runId);
      } else {
        onClose();
      }
    },
  });

  const hasResult = !!runId;
  const properties = job?.inputSchema?.properties || {};
  const hasForm = Object.keys(properties).length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{hasResult ? "Job started" : "Run job"}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{job?.id}</DialogDescription>
        </DialogHeader>

        {hasResult ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Job dispatched successfully.
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border text-xs">
              <MetaRow label="Run ID" value={runId!} mono />
            </div>
          </div>
        ) : (
          <div className="py-2">
            {hasForm ? (
              <FieldGroup className="gap-4">
                {Object.entries(properties).map(([key, schema]: [string, any]) => (
                  <Field key={key}>
                    <FieldContent>
                      <FieldLabel htmlFor={key} className="capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </FieldLabel>
                    </FieldContent>
                    {schema["x-picker"] === "user" ? (
                      <UserPicker
                        value={formData[key]}
                        onChange={(v) => setFormData({ ...formData, [key]: v })}
                      />
                    ) : schema["x-picker"] === "connection" ? (
                      <ConnectionPicker
                        value={formData[key]}
                        onChange={(v) => setFormData({ ...formData, [key]: v })}
                      />
                    ) : (
                      <Input
                        id={key}
                        type={schema.type === "number" ? "number" : "text"}
                        value={formData[key] || ""}
                        onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </FieldGroup>
            ) : (
              <div className="text-sm text-muted-foreground">
                This will immediately start a new run of{" "}
                <span className="font-mono text-foreground">{job?.id}</span>, bypassing its
                schedule.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {hasResult ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? (
                  <>
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-3.5" />
                    Run now
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
