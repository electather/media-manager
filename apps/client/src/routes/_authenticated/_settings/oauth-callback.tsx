import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import {
  ErrorScreen,
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateMedia,
  ErrorStateTitle,
} from "@/shared/components/error-state";
import { api } from "@/shared/lib/api";
import { safeJson } from "@/shared/lib/diagnostics/safe-json";

export const Route = createFileRoute("/_authenticated/_settings/oauth-callback")({
  component: OAuthCallbackPage,
});

type State =
  | { kind: "working" }
  | { kind: "ok"; pluginName: string }
  | { kind: "error"; message: string };

interface StoredPending {
  nonce: string;
  pluginId: string;
  pluginName: string;
}

function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "working" });
  // Guard against the StrictMode double-invocation so we don't double-complete on dev.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const queryParams: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((value, key) => {
      queryParams[key] = value;
    });

    const raw = sessionStorage.getItem("connections.oauthPending");
    if (!raw) {
      setState({
        kind: "error",
        message:
          "No pending authorization was found in this browser. Start again from the Connections page.",
      });
      return;
    }

    let pending: StoredPending;
    try {
      pending = JSON.parse(raw) as StoredPending;
    } catch {
      sessionStorage.removeItem("connections.oauthPending");
      setState({
        kind: "error",
        message: "Pending authorization data was corrupted.",
      });
      return;
    }
    sessionStorage.removeItem("connections.oauthPending");

    // fallow-ignore-next-line complexity
    void (async () => {
      try {
        const res = await api.connections.oauth.redirect.complete.$post({
          json: { nonce: pending.nonce, queryParams },
        });
        if (!res.ok) {
          const body = (await safeJson(res)) as {
            error?: string;
            message?: string;
          } | null;
          throw new Error(body?.error ?? body?.message ?? "Authorization failed.");
        }
        setState({ kind: "ok", pluginName: pending.pluginName });
        window.setTimeout(() => {
          void navigate({ to: "/settings/connections" });
        }, 1200);
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Authorization failed.",
        });
      }
    })();
  }, [navigate]);

  if (state.kind === "error") {
    return (
      <ErrorScreen>
        <ErrorState orientation="vertical" className="max-w-md">
          <ErrorStateMedia size="lg">
            <TriangleAlertIcon />
          </ErrorStateMedia>
          <ErrorStateContent>
            <ErrorStateTitle>{m.errors_oauth_callback_title()}</ErrorStateTitle>
            <ErrorStateDescription>{state.message}</ErrorStateDescription>
          </ErrorStateContent>
          <ErrorStateActions>
            <Button render={<Link to="/settings/connections" />}>
              {m.errors_oauth_callback_back()}
            </Button>
          </ErrorStateActions>
        </ErrorState>
      </ErrorScreen>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        {state.kind === "working" ? (
          <>
            <LoaderCircleIcon className="size-7 animate-spin text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold">Finishing authorization…</h1>
              <p className="text-sm text-muted-foreground">
                Hang tight while we complete the connection.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex size-12 items-center justify-center rounded-full bg-green-600/15 text-green-600 dark:text-green-400">
              <CheckIcon className="size-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold">{state.pluginName} connected</h1>
              <p className="text-sm text-muted-foreground">Taking you back to Connections…</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
