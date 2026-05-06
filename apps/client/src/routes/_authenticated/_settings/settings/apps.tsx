import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Field, FieldDescription, FieldTitle } from "@/shared/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/ui/input-group";
import { Skeleton } from "@/shared/ui/skeleton";
import { AuthorizedAppRow } from "@/features/settings";
import { useCopyFeedback } from "@/shared/hooks/use-copy-feedback";
import { api } from "@/shared/lib/api";

export const Route = createFileRoute("/_authenticated/_settings/settings/apps")({
  component: AuthorizedAppsSection,
});

const APPS_QUERY_KEY = ["me", "apps"] as const;

function AuthorizedAppsSection() {
  return (
    <div className="flex flex-col gap-6">
      <Header />
      <McpEndpointBlock />
      <AppsList />
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="text-base font-medium">Authorized applications</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        AI assistants and other MCP clients authorized to access your account.
      </p>
    </div>
  );
}

function McpEndpointBlock() {
  const { copied, copy } = useCopyFeedback();
  const endpoint = `${window.location.origin}/mcp`;

  const handleCopy = () => {
    void copy(endpoint);
  };

  return (
    <div className="flex max-w-lg flex-col gap-1.5">
      <Field>
        <FieldTitle>Your MCP endpoint</FieldTitle>
        <InputGroup>
          <InputGroupInput readOnly value={endpoint} className="font-mono text-xs" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={handleCopy} aria-label="Copy endpoint">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription>Use this URL to connect an MCP client to your account.</FieldDescription>
      </Field>
    </div>
  );
}

// fallow-ignore-next-line complexity
export function AppsList() {
  const qc = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState<AuthorizedApp | null>(null);

  const appsQuery = useQuery({
    queryKey: APPS_QUERY_KEY,
    queryFn: async () => {
      const res = await api.me.apps.$get();
      if (!res.ok) throw new Error("failed to load authorized apps");
      return res.json();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const res = await api.me.apps[":clientId"].revoke.$post({ param: { clientId } });
      if (!res.ok) {
        if (res.status === 404) {
          throw Object.assign(new Error("already revoked"), { code: "ALREADY_REVOKED" });
        }
        throw new Error("revoke failed");
      }
      return res.json();
    },
    onSuccess: (data, clientId) => {
      const app = appsQuery.data?.find((a) => a.clientId === clientId);
      toast.success(`Access revoked for ${app?.name ?? clientId}.`);
      qc.setQueryData(APPS_QUERY_KEY, data.apps);
      setConfirmRevoke(null);
    },
    // fallow-ignore-next-line complexity
    onError: (err: unknown) => {
      const code = (err as { code?: string } | null)?.code;
      if (code === "ALREADY_REVOKED") {
        toast.info("Already revoked.");
        void qc.invalidateQueries({ queryKey: APPS_QUERY_KEY });
        setConfirmRevoke(null);
        return;
      }
      const message = (err as { message?: string } | null)?.message ?? "Could not revoke.";
      toast.error(message);
    },
  });

  if (appsQuery.isPending) {
    return (
      <div className="flex max-w-lg flex-col gap-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (appsQuery.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Could not load authorized applications.{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => appsQuery.refetch()}
        >
          Retry
        </button>
      </p>
    );
  }

  const apps = appsQuery.data ?? [];

  if (apps.length === 0) {
    return (
      <div className="flex max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-9 text-center">
        <p className="text-sm font-medium">No authorized applications</p>
        <p className="text-sm text-muted-foreground">
          Connect an MCP client using the endpoint URL above to get started.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex max-w-lg flex-col gap-0 divide-y divide-border rounded-xl border border-border">
        {apps.map((app) => (
          <AuthorizedAppRow
            key={app.clientId}
            app={app}
            onRevoke={() => setConfirmRevoke(app)}
            pending={revokeMutation.isPending && revokeMutation.variables === app.clientId}
          />
        ))}
      </div>

      <Dialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokeMutation.isPending) setConfirmRevoke(null);
        }}
      >
        <DialogContent showCloseButton={!revokeMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Revoke access for "{confirmRevoke?.name}"?</DialogTitle>
            <DialogDescription>
              This client will no longer be able to access your account. You'll need to re-authorize
              it to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRevoke(null)}
              disabled={revokeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && revokeMutation.mutate(confirmRevoke.clientId)}
              disabled={revokeMutation.isPending}
              data-testid="confirm-revoke-app"
            >
              {revokeMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
