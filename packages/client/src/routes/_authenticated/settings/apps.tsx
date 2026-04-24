import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthApp {
  id: string;
  name: string;
  clientId: string;
  connected: string;
  lastUsed: string;
  scopes: string[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MCP_ENDPOINT = `${window.location.origin}/mcp`;

const MOCK_AUTH_APPS: AuthApp[] = [
  {
    id: "a1",
    name: "Claude Desktop",
    clientId: "mcp_cd_8f3a2c1b9e",
    connected: "3 weeks ago",
    lastUsed: "2h ago",
    scopes: ["read", "write", "request"],
  },
  {
    id: "a2",
    name: "Cursor",
    clientId: "mcp_cu_4d1e8a7c2f",
    connected: "1 week ago",
    lastUsed: "yesterday",
    scopes: ["read", "request"],
  },
  {
    id: "a3",
    name: "Custom CLI",
    clientId: "mcp_cl_2b9f6e3d5a",
    connected: "2 months ago",
    lastUsed: "3 weeks ago",
    scopes: ["read"],
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings/apps")({
  component: AuthorizedAppsSection,
});

function AuthorizedAppsSection() {
  const [copied, setCopied] = useState(false);
  const [apps, setApps] = useState(MOCK_AUTH_APPS);
  const [revokeTarget, setRevokeTarget] = useState<AuthApp | null>(null);

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRevoke = () => {
    if (revokeTarget) {
      setApps((prev) => prev.filter((a) => a.id !== revokeTarget.id));
      setRevokeTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-medium">Authorized applications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          AI assistants and other MCP clients authorized to access your account.
        </p>
      </div>

      <div className="flex max-w-lg flex-col gap-1.5">
        <Field>
          <FieldTitle>Your MCP endpoint</FieldTitle>
          <InputGroup>
            <InputGroupInput readOnly value={MCP_ENDPOINT} className="font-mono text-xs" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={handleCopy} aria-label="Copy endpoint">
                {copied ? <CheckIcon /> : <CopyIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>
            Use this URL to connect an MCP client to your account.
          </FieldDescription>
        </Field>
      </div>

      {apps.length === 0 ? (
        <div className="flex max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-9 text-center">
          <p className="text-sm font-medium">No authorized applications</p>
          <p className="text-sm text-muted-foreground">
            Connect an MCP client using the endpoint URL above to get started.
          </p>
          <Button variant="outline" size="sm">
            View setup guides
          </Button>
        </div>
      ) : (
        <div className="flex max-w-lg flex-col gap-0 divide-y divide-border rounded-xl border border-border">
          {apps.map((app) => (
            <div key={app.id} className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">{app.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{app.clientId}</p>
                <p className="text-xs text-muted-foreground">
                  Connected {app.connected} · Last active {app.lastUsed}
                </p>
                <div className="flex flex-wrap gap-1">
                  {app.scopes.map((scope) => (
                    <Badge key={scope} variant="secondary">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRevokeTarget(app)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Revoke access for "{revokeTarget?.name}"?</DialogTitle>
            <DialogDescription>
              This client will no longer be able to access your account. You'll need to re-authorize
              it to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke}>
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
