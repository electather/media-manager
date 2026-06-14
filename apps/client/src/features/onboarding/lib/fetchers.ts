import type { BootstrapClaimBody } from "@nama/shared/bootstrap";
import type { OnboardingState } from "@nama/shared/onboarding";
import type { PublicConfig } from "@nama/shared/users";
import { api } from "@/shared/lib/api";
import { readOkJson } from "@/shared/lib/api/throw-on-error";
import { OnboardingApiError } from "./types";

const readJson = <R extends Response>(res: R) => readOkJson(res, OnboardingApiError);

/** Result of a TMDB shared-credential probe. `ok` gates the green/red surface. */
export interface TmdbTestResult {
  ok: boolean;
  message?: string;
}

/** Reads the pre-session public config, including `needsBootstrap`. */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  return readJson(await api.config.public.$get());
}

/** Creates the first administrator from a one-time setup token. */
export async function claimBootstrap(body: BootstrapClaimBody): Promise<{ ok: boolean }> {
  return readJson(await api.bootstrap.claim.$post({ json: body }));
}

/** Reads the server-resolved onboarding step list for the current user. */
export async function fetchOnboardingState(): Promise<OnboardingState> {
  return readJson(await api.onboarding.state.$get());
}

/** Server-authoritatively flips `hasOnboarded` once required steps are complete. */
export async function completeOnboarding(): Promise<{ ok: boolean }> {
  return readJson(await api.onboarding.complete.$post());
}

/** Verifies a candidate TMDB API key without persisting it. */
export async function testTmdbKey(apiKey: string): Promise<TmdbTestResult> {
  return readJson(
    await api.plugins[":id"]["shared-credentials"]["test-ephemeral"].$post({
      param: { id: "tmdb" },
      json: { value: { apiKey } },
    }),
  );
}

/** Persists the TMDB API key as the default shared credential. */
export async function saveTmdbKey(apiKey: string): Promise<{ id: string }> {
  return readJson(
    await api.plugins[":id"]["shared-credentials"].$post({
      param: { id: "tmdb" },
      json: { label: "Default", value: { apiKey } },
    }),
  );
}
