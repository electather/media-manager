import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ExternalLinkIcon, XCircleIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { saveTmdbKey, testTmdbKey } from "../../lib/fetchers";
import { onboardingKeys } from "../../lib/query-keys";

const TMDB_API_KEY_URL = "https://www.themoviedb.org/settings/api";

/**
 * Admin TMDB shared-credential form. Completeness is derived server-side from
 * the onboarding state, so this form only tests and saves the key — saving
 * invalidates the onboarding state so the wizard re-reads the required-step gate.
 */
export function TmdbKeyForm() {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");

  const test = useMutation({ mutationFn: testTmdbKey });
  const save = useMutation({
    mutationFn: saveTmdbKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: onboardingKeys.state() }),
  });

  const trimmed = apiKey.trim();
  const busy = test.isPending || save.isPending;

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="tmdb-api-key">{m.onboarding_tmdb_label()}</FieldLabel>
        <Input
          id="tmdb-api-key"
          value={apiKey}
          placeholder={m.onboarding_tmdb_placeholder()}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
      </Field>

      <p className="text-xs text-muted-foreground">{m.onboarding_tmdb_why()}</p>

      <a
        href={TMDB_API_KEY_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        {m.onboarding_tmdb_get_key()}
        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
      </a>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!trimmed || busy}
          onClick={() => test.mutate(trimmed)}
        >
          {m.onboarding_tmdb_test({ status: test.isPending ? "pending" : "idle" })}
        </Button>
        <Button type="button" disabled={!trimmed || busy} onClick={() => save.mutate(trimmed)}>
          {m.onboarding_tmdb_save({ status: save.isPending ? "pending" : "idle" })}
        </Button>
      </div>

      <TestResult result={test.data} failed={test.isError} />
      {save.isError && (
        <p className="text-sm font-medium text-destructive">{m.onboarding_tmdb_save_failed()}</p>
      )}
      {save.isSuccess && (
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2Icon className="size-4" aria-hidden="true" />
          {m.onboarding_tmdb_saved()}
        </p>
      )}
    </div>
  );
}

/** Inline green/red feedback from the ephemeral test probe. */
function TestResult({ result, failed }: { result?: { ok: boolean }; failed: boolean }) {
  if (failed || (result && !result.ok)) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
        <XCircleIcon className="size-4" aria-hidden="true" />
        {m.onboarding_tmdb_test_failed()}
      </p>
    );
  }
  if (result?.ok) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <CheckCircle2Icon className="size-4" aria-hidden="true" />
        {m.onboarding_tmdb_test_ok()}
      </p>
    );
  }
  return null;
}
