import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  BookOpenIcon,
  LockIcon,
  MailIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldIcon,
  StarIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react";
import { z } from "zod";

import { authClient } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// ─── Scope metadata ───────────────────────────────────────────────────────────

interface ScopeInfo {
  label: string;
  description: string;
  icon: React.ReactNode;
}

const SCOPE_META: Record<string, ScopeInfo> = {
  "mcp.read": {
    label: "Read media library",
    description: "Access your media history and ratings",
    icon: <BookOpenIcon className="size-4" />,
  },
  "mcp.write.feedback": {
    label: "Submit feedback",
    description: "Rate content and update your taste profile",
    icon: <StarIcon className="size-4" />,
  },
  "mcp.write.request": {
    label: "Create requests",
    description: "Add content requests to your queue",
    icon: <SendIcon className="size-4" />,
  },
  "mcp.ext": {
    label: "Plugin extensions",
    description: "Access capabilities from installed plugins",
    icon: <PuzzleIcon className="size-4" />,
  },
  profile: {
    label: "Read profile",
    description: "Access your name and avatar",
    icon: <UserIcon className="size-4" />,
  },
  email: {
    label: "Read email address",
    description: "Access your email address",
    icon: <MailIcon className="size-4" />,
  },
  offline_access: {
    label: "Offline access",
    description: "Stay connected without signing in each time",
    icon: <RefreshCwIcon className="size-4" />,
  },
};

/** Scopes that are implicit and not worth showing to the user. */
const HIDDEN_SCOPES = new Set(["openid"]);

// ─── Route ────────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  consent_code: z.string().min(1),
  client_id: z.string().min(1),
  scope: z.string().min(1),
});

export const Route = createFileRoute("/oauth/consent")({
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session) {
      throw redirect({ to: "/auth/login" });
    }
    return { session };
  },
  component: ConsentPage,
  errorComponent: InvalidRequestPage,
});

// ─── Error page ───────────────────────────────────────────────────────────────

function InvalidRequestPage() {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex flex-col items-center gap-4 px-6 pt-10 pb-8">
        <div className="flex size-11 items-center justify-center rounded-xl bg-destructive/10">
          <TriangleAlertIcon className="size-5 text-destructive" />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-base font-semibold">Invalid authorization request</h1>
          <p className="text-sm text-muted-foreground">
            This link is invalid, malformed, or has already been used. Close this tab and try
            connecting again from your application.
          </p>
        </div>
      </div>

      <Separator />

      <div className="px-6 py-5">
        <Button variant="outline" className="w-full" render={<Link to="/" />}>
          Go home
        </Button>
      </div>
    </div>
  );
}

// ─── Consent page ─────────────────────────────────────────────────────────────

function ConsentPage() {
  const { consent_code, client_id, scope } = Route.useSearch();
  const { session } = Route.useRouteContext();

  const scopes = scope.split(/\s+/).filter(Boolean);
  const visibleScopes = scopes.filter((s) => !HIDDEN_SCOPES.has(s));
  const user = session.user;

  const mutation = useMutation({
    mutationFn: async (accept: boolean) => {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, consent_code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Consent request failed.");
      }
      const { redirectURI } = (await res.json()) as { redirectURI: string };
      return redirectURI;
    },
    onSuccess: (redirectURI) => {
      window.location.href = redirectURI;
    },
  });

  const busy = mutation.isPending;

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      {/* Header */}
      <div className="flex flex-col items-center gap-4 px-6 pt-8 pb-7">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
          <LockIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-base font-semibold">Authorize access</h1>
          <p className="text-sm text-muted-foreground">
            An application is requesting access to your account.
          </p>
          <code className="mt-0.5 rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {client_id}
          </code>
        </div>
      </div>

      <Separator />

      {/* Authorizing as */}
      <div className="flex items-center gap-3 px-6 py-4">
        <UserAvatar name={user.name} email={user.email} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <Separator />

      {/* Permissions */}
      <div className="flex flex-col gap-4 px-6 py-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Permissions requested
        </p>
        {visibleScopes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Basic identity access only.</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {visibleScopes.map((s) => {
              const meta = SCOPE_META[s];
              return (
                <div key={s} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                    {meta?.icon ?? <ShieldIcon className="size-4" />}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium leading-tight">{meta?.label ?? s}</p>
                    {meta?.description && (
                      <p className="text-xs text-muted-foreground">{meta.description}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {mutation.isError && (
        <div className="mx-6 mb-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {mutation.error.message}
        </div>
      )}

      <Separator />

      {/* Actions */}
      <div className="flex flex-col gap-2 px-6 py-5">
        <Button className="w-full" disabled={busy} onClick={() => mutation.mutate(true)}>
          {mutation.isPending && mutation.variables === true ? "Authorizing…" : "Allow access"}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => mutation.mutate(false)}
        >
          {mutation.isPending && mutation.variables === false ? "Canceling…" : "Cancel"}
        </Button>
      </div>

      {/* Footer */}
      <p className="px-6 pb-6 text-center text-xs text-muted-foreground">
        You can revoke access at any time from your{" "}
        <Link
          to="/settings"
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          settings
        </Link>
        .
      </p>
    </div>
  );
}
