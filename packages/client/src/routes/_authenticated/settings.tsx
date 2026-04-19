import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavId = "profile" | "apps" | "danger";

interface AuthApp {
  id: string;
  name: string;
  clientId: string;
  connected: string;
  lastUsed: string;
  scopes: string[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USER = {
  name: "Alex Morgan",
  email: "alex@example.com",
  color: "#8B5CF6",
};

const MOCK_MCP_ENDPOINT = "https://home-media.lan/mcp/u/alex";

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

const NAV: { id: NavId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "apps", label: "Authorized apps" },
  { id: "danger", label: "Danger zone" },
];

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function ProfileSection() {
  const [name, setName] = useState(MOCK_USER.name);
  const [email, setEmail] = useState(MOCK_USER.email);
  const [pwOpen, setPwOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = name !== MOCK_USER.name || email !== MOCK_USER.email;

  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-medium">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your personal information. Initials are generated from your name and shown in other users'
          views where relevant.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback style={{ background: MOCK_USER.color, color: "#fff" }}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">Avatar generated from your name.</p>
        </div>
      </div>

      <div className="flex max-w-sm flex-col gap-4">
        <Field>
          <FieldTitle>Name</FieldTitle>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field>
          <FieldTitle>Email</FieldTitle>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <FieldDescription>Changing your email will require verification.</FieldDescription>
        </Field>

        <Field>
          <FieldTitle>Password</FieldTitle>
          {!pwOpen ? (
            <div>
              <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
                Change password
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <Field>
                <FieldTitle>Current password</FieldTitle>
                <Input type="password" defaultValue="••••••••••" />
              </Field>
              <Field>
                <FieldTitle>New password</FieldTitle>
                <Input type="password" placeholder="At least 12 characters" />
              </Field>
              <Field>
                <FieldTitle>Confirm new password</FieldTitle>
                <Input type="password" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPwOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => setPwOpen(false)}>
                  Save password
                </Button>
              </div>
            </div>
          )}
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!dirty} onClick={handleSave}>
          Save changes
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckIcon className="size-3" /> Saved
          </span>
        )}
        {!dirty && !saved && <span className="text-xs text-muted-foreground">No changes</span>}
      </div>
    </div>
  );
}

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
            <InputGroupInput readOnly value={MOCK_MCP_ENDPOINT} className="font-mono text-xs" />
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

function DangerZoneSection() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const email = MOCK_USER.email;

  const handleClose = () => {
    setDeleteOpen(false);
    setDeleteConfirm("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-medium">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Irreversible actions. Proceed with care.
        </p>
      </div>

      <div className="flex max-w-lg items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Delete account</p>
          <p className="text-xs text-muted-foreground">
            Permanently delete your account and all associated data — connections, taste profile,
            feedback history, and preferences. This cannot be undone.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This will permanently delete your account and all data. Type your email address{" "}
              <strong className="text-foreground">{email}</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Your email address"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteConfirm !== email} onClick={handleClose}>
              Delete my account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [nav, setNav] = useState<NavId>("profile");

  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <div>
        <h1 className="text-3xl font-semibold">Settings</h1>
      </div>

      <div className="flex gap-8">
        <nav className="flex w-44 shrink-0 flex-col gap-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={nav === item.id}
              onClick={() => setNav(item.id)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors aria-selected:bg-muted aria-selected:font-medium hover:bg-muted/60"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <Separator orientation="vertical" />

        <div className="min-w-0 flex-1 pb-10">
          {nav === "profile" && <ProfileSection />}
          {nav === "apps" && <AuthorizedAppsSection />}
          {nav === "danger" && <DangerZoneSection />}
        </div>
      </div>
    </div>
  );
}
