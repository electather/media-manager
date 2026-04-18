import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Link2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PowerIcon,
  StarIcon,
  XIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceId = "trakt" | "seerr" | "tmdb" | "tvdb";
type ConnectionStatus = "connected" | "expired" | "error" | "disabled";

interface Service {
  id: ServiceId;
  name: string;
  description: string;
  connectionType: "oauth" | "manual" | "apikey";
  capabilities: string[];
  allowMultiple: boolean;
  sharedKey: boolean;
}

interface Connection {
  id: string;
  service: ServiceId;
  name: string;
  status: ConnectionStatus;
  verified: string;
  url?: string;
  error?: string;
  isDefault?: boolean;
  usingShared?: boolean;
}

type ModalState =
  | { type: "trakt"; editing?: Connection }
  | { type: "seerr"; editing?: Connection }
  | { type: "api"; service: Service; editing?: Connection }
  | { type: "confirm"; conn: Connection; service: Service }
  | null;

// ─── Static data ──────────────────────────────────────────────────────────────

const SERVICES: Record<ServiceId, Service> = {
  trakt: {
    id: "trakt",
    name: "Trakt",
    description:
      "Scrobble what you watch. The richest single integration — most users connect this first.",
    connectionType: "oauth",
    capabilities: ["Watch History", "Watchlist", "Ratings", "Recommendations", "Calendar"],
    allowMultiple: false,
    sharedKey: false,
  },
  seerr: {
    id: "seerr",
    name: "Seerr",
    description: "Overseerr or Jellyseerr. Media requesting, availability, and watchlist.",
    connectionType: "manual",
    capabilities: ["Media Requesting", "Availability Status", "Watchlist"],
    allowMultiple: true,
    sharedKey: false,
  },
  tmdb: {
    id: "tmdb",
    name: "TMDB",
    description: "The Movie Database. Metadata, posters, search, similar titles.",
    connectionType: "apikey",
    capabilities: ["Metadata", "Posters", "Search", "Similar Titles"],
    allowMultiple: false,
    sharedKey: true,
  },
  tvdb: {
    id: "tvdb",
    name: "TVDB",
    description: "Secondary TV metadata source. Episode data, airing schedules.",
    connectionType: "apikey",
    capabilities: ["TV Metadata", "Episode Data"],
    allowMultiple: false,
    sharedKey: true,
  },
};

const SERVICE_ORDER: ServiceId[] = ["trakt", "seerr", "tmdb", "tvdb"];

const MOCK_CONNECTIONS: Connection[] = [
  {
    id: "c1",
    service: "trakt",
    name: "Trakt",
    status: "connected",
    verified: "5m ago",
  },
  {
    id: "c2",
    service: "seerr",
    name: "Home Server",
    url: "https://seerr.home.local:5055",
    status: "connected",
    verified: "14m ago",
    isDefault: true,
  },
  {
    id: "c3",
    service: "seerr",
    name: "Sarah's Jellyseerr",
    url: "https://jellyseerr.sarahs.net",
    status: "connected",
    verified: "1h ago",
    isDefault: false,
  },
  {
    id: "c4",
    service: "tmdb",
    name: "TMDB",
    status: "connected",
    verified: "2h ago",
    usingShared: false,
  },
  {
    id: "c5",
    service: "tvdb",
    name: "TVDB (server key)",
    status: "connected",
    verified: "2h ago",
    usingShared: true,
  },
];

// ─── Primitives ───────────────────────────────────────────────────────────────

function statusBadge(status: ConnectionStatus) {
  if (status === "error")
    return (
      <Badge variant="destructive">
        <AlertTriangleIcon />
        Error
      </Badge>
    );
  if (status === "expired")
    return (
      <Badge variant="outline">
        <AlertTriangleIcon />
        Expired
      </Badge>
    );
  if (status === "disabled") return <Badge variant="secondary">Disabled</Badge>;
  return (
    <Badge variant="secondary">
      <CheckIcon />
      Connected
    </Badge>
  );
}

function SecretInput({ placeholder, mono }: { placeholder: string; mono?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput
        type={show ? "text" : "password"}
        placeholder={placeholder}
        className={cn(mono && "font-mono text-xs")}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Show"}>
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

// ─── Section components ───────────────────────────────────────────────────────

function SectionHead({ service }: { service: Service }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pb-1">
      <h3 className="text-lg font-semibold tracking-tight">{service.name}</h3>
      <div className="flex flex-wrap gap-1.5">
        {service.capabilities.map((c) => (
          <Badge key={c} variant="secondary" className="text-sm font-normal">
            {c}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function AddCard({ service, onClick }: { service: Service; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer min-h-27.5 items-center justify-center gap-2 rounded-4xl border border-dashed border-border px-5 py-6 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground hover:bg-accent hover:text-foreground"
    >
      <Link2Icon className="size-3.5" />
      Add {service.name} connection
    </button>
  );
}

function SharedKeyNote({ service, onAddOwn }: { service: Service; onAddOwn: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-4xl border border-border bg-muted px-6 py-4">
      <div>
        <p className="text-sm">
          Using <strong className="font-medium">server's shared {service.name} key</strong>
        </p>
        <FieldDescription className="mt-0.5">
          No action needed — {service.name} is working. Add your own key if you'd rather use a
          personal quota.
        </FieldDescription>
      </div>
      <Button variant="outline" size="sm" onClick={onAddOwn}>
        Add your own key
      </Button>
    </div>
  );
}

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({
  conn,
  service,
  showDefault,
  onRemove,
  onOpenTraktEdit,
  onOpenSeerrEdit,
  onOpenApiEdit,
}: {
  conn: Connection;
  service: Service;
  showDefault: boolean;
  onRemove: (conn: Connection, service: Service) => void;
  onOpenTraktEdit: (conn: Connection) => void;
  onOpenSeerrEdit: (conn: Connection) => void;
  onOpenApiEdit: (conn: Connection, service: Service) => void;
}) {
  const [testing, setTesting] = useState<null | "loading" | "ok">(null);
  const isDisabled = conn.status === "disabled";
  const isBroken = conn.status === "error" || conn.status === "expired";

  const runTest = () => {
    setTesting("loading");
    setTimeout(() => setTesting("ok"), 1100);
    setTimeout(() => setTesting(null), 4500);
  };

  const handleEdit = () => {
    if (service.id === "trakt") onOpenTraktEdit(conn);
    else if (service.id === "seerr") onOpenSeerrEdit(conn);
    else onOpenApiEdit(conn, service);
  };

  const handleReconnect = () => {
    if (service.connectionType === "oauth") {
      alert(`Would redirect to ${service.name} OAuth…`);
    } else {
      handleEdit();
    }
  };

  return (
    <Card
      size="sm"
      className={cn(
        "gap-3 transition-opacity",
        isDisabled && "opacity-55",
        conn.status === "error" && "ring-destructive/40",
        conn.status === "expired" && "ring-amber-500/50",
      )}
    >
      <CardHeader className="">
        <CardTitle className="flex flex-wrap items-center gap-2 font-semibold">
          {conn.name}
          {statusBadge(conn.status)}
          {showDefault && conn.isDefault && (
            <Badge variant="outline" className="text-xs">
              Default
            </Badge>
          )}
          {conn.usingShared && (
            <Badge variant="secondary" className="text-xs font-normal">
              Server key
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="More actions"
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={runTest}>
                <CheckIcon /> Test connection
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEdit}>
                <PencilIcon /> Edit
              </DropdownMenuItem>
              {showDefault && !conn.isDefault && !isDisabled && (
                <DropdownMenuItem>
                  <StarIcon /> Set as default
                </DropdownMenuItem>
              )}
              <DropdownMenuItem>
                <PowerIcon /> {isDisabled ? "Enable" : "Disable"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(conn, service)}>
                <XIcon /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-0.5">
        {conn.url && (
          <span className="font-mono text-[11.5px] text-muted-foreground">{conn.url}</span>
        )}
        <span className="text-[12.5px] text-muted-foreground">
          {isDisabled ? "Last verified " : "Verified "}
          {conn.verified}
        </span>
        {conn.error && (
          <span className="mt-0.5 text-[12.5px] leading-snug text-destructive">{conn.error}</span>
        )}
      </CardContent>

      <CardFooter className="">
        {isBroken ? (
          <Button size="sm" onClick={handleReconnect}>
            <Link2Icon /> Reconnect
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={runTest}>
            {testing === "loading"
              ? "Testing…"
              : testing === "ok"
                ? "✓ Connection healthy"
                : "Test connection"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: (service: Service) => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-10">
      <div className="flex max-w-155 flex-col items-center gap-4 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card">
          <Link2Icon className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-semibold tracking-tight">No services connected</h2>
          <p className="max-w-[42ch] text-base leading-relaxed text-muted-foreground">
            Connect your media services to start tracking what you watch, requesting downloads, and
            getting personalized recommendations.
          </p>
        </div>
        <div className="mt-2 grid w-full max-w-140 grid-cols-2 gap-3">
          {SERVICE_ORDER.map((id) => {
            const s = SERVICES[id];
            return (
              <button
                key={id}
                onClick={() => onAdd(s)}
                className="flex flex-col gap-2 rounded-4xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground hover:bg-accent"
              >
                <span className="text-sm font-semibold">{s.name}</span>
                <div className="flex flex-wrap gap-1">
                  {s.capabilities.slice(0, 4).map((c) => (
                    <Badge key={c} variant="secondary" className="text-[10.5px] font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function TraktModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Connection;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>{editing ? "Edit" : "Add"} Trakt Connection</DialogTitle>
          <DialogDescription>
            Trakt powers watch history, ratings, watchlist, and calendar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 pb-4">
          <Field>
            <FieldTitle>
              Display name
              <span className="text-xs font-normal text-muted-foreground">optional</span>
            </FieldTitle>
            <Input placeholder="My Trakt Account" defaultValue={editing ? "Trakt" : ""} />
          </Field>
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted px-4 py-6 text-center">
            <Button>Connect with Trakt</Button>
            <FieldDescription className="max-w-[34ch]">
              You'll be redirected to Trakt to authorize access. We request read/write access to
              your watch history, ratings, and watchlist.
            </FieldDescription>
          </div>
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeerrModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Connection;
}) {
  const [tested, setTested] = useState<null | "loading" | "ok" | "err">(null);
  const runTest = () => {
    setTested("loading");
    setTimeout(() => setTested("ok"), 1200);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setTested(null);
        }
      }}
    >
      <DialogContent className="gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>{editing ? "Edit" : "Add"} Seerr Connection</DialogTitle>
          <DialogDescription>
            Overseerr or Jellyseerr — self-hosted request manager.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 pb-4">
          <Field>
            <FieldTitle>
              Display name
              <span className="text-xs font-normal text-muted-foreground">optional</span>
            </FieldTitle>
            <Input placeholder="Home Server" defaultValue={editing ? "Home Server" : ""} />
          </Field>
          <Field>
            <FieldTitle>Instance URL</FieldTitle>
            <Input
              className="font-mono text-xs"
              placeholder="https://seerr.example.com"
              defaultValue={editing ? "https://seerr.home.local:5055" : ""}
            />
            <FieldDescription>
              The base URL where your Overseerr/Jellyseerr is reachable.
            </FieldDescription>
          </Field>
          <Field>
            <FieldTitle>API key</FieldTitle>
            <SecretInput placeholder="••••••••••••••••••••••••••••" mono />
            <FieldDescription>
              Found under Settings → General → API Key in your Seerr instance.
            </FieldDescription>
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={runTest}>
              {tested === "loading" ? "Testing…" : "Test connection"}
            </Button>
            {tested === "ok" && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <CheckIcon className="size-3" /> Connected — 2 instances reachable
              </span>
            )}
            {tested === "err" && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <XIcon className="size-3" /> Could not reach host
              </span>
            )}
          </div>
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onClose}>Save connection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyModal({
  open,
  onClose,
  service,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  service: Service;
  editing?: Connection;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>
            {editing ? "Edit" : "Add"} {service.name} Connection
          </DialogTitle>
          <DialogDescription>{service.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-6 pb-4">
          {service.sharedKey && !editing && (
            <p className="rounded-2xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              A shared server key is available. You only need your own key if you want to use a
              personal API quota.
            </p>
          )}
          <Field>
            <FieldTitle>
              Display name
              <span className="text-xs font-normal text-muted-foreground">optional</span>
            </FieldTitle>
            <Input placeholder={service.name} defaultValue={editing ? service.name : ""} />
          </Field>
          <Field>
            <FieldTitle>API key</FieldTitle>
            <SecretInput placeholder="••••••••••••••••••••••••••••" mono />
            <FieldDescription>
              {`Get a free key at ${service.id === "tmdb" ? "themoviedb.org/settings/api" : "thetvdb.com/api-information"}.`}
            </FieldDescription>
          </Field>
          <div>
            <Button variant="outline" size="sm">
              Test connection
            </Button>
          </div>
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onClose}>Save connection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  conn,
  service,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  conn: Connection;
  service: Service;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-destructive">Remove {service.name} connection?</DialogTitle>
          <DialogDescription>
            This will remove the connection "{conn.name}". Your data on {service.name} is not
            affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Remove connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/connections")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const [modal, setModal] = useState<ModalState>(null);
  const connections = MOCK_CONNECTIONS;

  const brokenCount = connections.filter(
    (c) => c.status === "error" || c.status === "expired",
  ).length;
  const hasError = connections.some((c) => c.status === "error");

  const openAdd = (service: Service) => {
    if (service.id === "trakt") setModal({ type: "trakt" });
    else if (service.id === "seerr") setModal({ type: "seerr" });
    else setModal({ type: "api", service });
  };

  const byService = {} as Record<ServiceId, Connection[]>;
  SERVICE_ORDER.forEach((id) => {
    byService[id] = connections.filter((c) => c.service === id);
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <div>
        <h1 className="text-3xl font-semibold">Connections</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Connect your media services to enable tracking, requesting, and personalized
          recommendations through your AI assistant.
        </p>
      </div>

      {connections.length === 0 ? (
        <EmptyState onAdd={openAdd} />
      ) : (
        <>
          {brokenCount > 0 && (
            <Alert
              variant={hasError ? "destructive" : "default"}
              className={
                !hasError
                  ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-700 dark:text-amber-400"
                  : undefined
              }
            >
              <AlertTriangleIcon />
              <AlertTitle>
                {brokenCount} connection{brokenCount > 1 ? "s" : ""} need attention
              </AlertTitle>
              <AlertDescription>
                Some services aren't syncing. Features that rely on them — like requests or watch
                history — won't work until these are reconnected.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-10">
            {SERVICE_ORDER.map((id) => {
              const service = SERVICES[id];
              const items = byService[id];
              const showDefault = service.allowMultiple && items.length > 1;
              const showSharedNote = service.sharedKey && items.length === 0;

              return (
                <section key={id} className="flex flex-col gap-3.5">
                  <SectionHead service={service} />
                  {items.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {items.map((conn) => (
                        <ConnectionCard
                          key={conn.id}
                          conn={conn}
                          service={service}
                          showDefault={showDefault}
                          onRemove={(c, s) => setModal({ type: "confirm", conn: c, service: s })}
                          onOpenTraktEdit={(c) => setModal({ type: "trakt", editing: c })}
                          onOpenSeerrEdit={(c) => setModal({ type: "seerr", editing: c })}
                          onOpenApiEdit={(c, s) =>
                            setModal({ type: "api", service: s, editing: c })
                          }
                        />
                      ))}
                      <AddCard service={service} onClick={() => openAdd(service)} />
                    </div>
                  ) : showSharedNote ? (
                    <SharedKeyNote service={service} onAddOwn={() => openAdd(service)} />
                  ) : (
                    <AddCard service={service} onClick={() => openAdd(service)} />
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      <TraktModal
        open={modal?.type === "trakt"}
        onClose={() => setModal(null)}
        editing={modal?.type === "trakt" ? modal.editing : undefined}
      />
      <SeerrModal
        open={modal?.type === "seerr"}
        onClose={() => setModal(null)}
        editing={modal?.type === "seerr" ? modal.editing : undefined}
      />
      {modal?.type === "api" && (
        <ApiKeyModal
          open
          onClose={() => setModal(null)}
          service={modal.service}
          editing={modal.editing}
        />
      )}
      {modal?.type === "confirm" && (
        <ConfirmDialog
          open
          onClose={() => setModal(null)}
          onConfirm={() => setModal(null)}
          conn={modal.conn}
          service={modal.service}
        />
      )}
    </div>
  );
}
