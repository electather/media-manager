import { and, eq, sql } from "drizzle-orm";
import type {
  PreferenceProfile,
  ProfileFeatures,
  ProfileMediaType,
} from "@nama/shared/preferences";
import { getDb } from "../../db/client";
import { preferenceProfiles } from "../../db/schema";
import { deriveConfidence, emptyFeatures } from "../internal/constants";

/**
 * Server-internal extension of `PreferenceProfile` carrying the monotonic
 * `version` column. The version coordinates rec-list freshness (V43) and is
 * intentionally absent from the shared `PreferenceProfile` type to keep
 * `@nama/shared` server-internal-state-free per V12.
 */
export interface StoredPreferenceProfile extends PreferenceProfile {
  version: number;
}

export interface WriteProfileOptions {
  /**
   * When set, increments `preference_profiles.version` atomically as part of
   * the write. Reserved for full rebuilds (V43); incremental updates omit it.
   */
  bumpVersion?: boolean;
}

export async function readProfile(
  userId: string,
  mediaType: ProfileMediaType,
): Promise<StoredPreferenceProfile | null> {
  const row = await getDb()
    .select()
    .from(preferenceProfiles)
    .where(and(eq(preferenceProfiles.userId, userId), eq(preferenceProfiles.mediaType, mediaType)))
    .get();
  if (!row) return null;
  return toProfile(row);
}

export async function upsertProfile(
  profile: PreferenceProfile,
  opts: WriteProfileOptions = {},
): Promise<void> {
  const payload = {
    userId: profile.userId,
    mediaType: profile.mediaType,
    features: JSON.stringify(profile.features),
    sampleSize: profile.sampleSize,
    confidence: deriveConfidence(profile.sampleSize),
    lastRebuiltAt: profile.lastRebuiltAt,
    lastUpdatedAt: profile.lastUpdatedAt,
    embedding: null,
    embeddingModel: null,
    // Initial-insert version: bumping callers start at 1 so the first
    // rebuild is observable as a non-zero `profile_version` on rec lists.
    version: opts.bumpVersion ? 1 : 0,
  };
  const set: Record<string, unknown> = {
    features: payload.features,
    sampleSize: payload.sampleSize,
    confidence: payload.confidence,
    lastRebuiltAt: payload.lastRebuiltAt,
    lastUpdatedAt: payload.lastUpdatedAt,
  };
  if (opts.bumpVersion) {
    set.version = sql`${preferenceProfiles.version} + 1`;
  }
  await getDb()
    .insert(preferenceProfiles)
    .values(payload)
    .onConflictDoUpdate({
      target: [preferenceProfiles.userId, preferenceProfiles.mediaType],
      set,
    });
}

function toProfile(row: typeof preferenceProfiles.$inferSelect): StoredPreferenceProfile {
  return {
    userId: row.userId,
    mediaType: row.mediaType,
    features: parseFeatures(row.features),
    sampleSize: row.sampleSize,
    confidence: row.confidence,
    lastRebuiltAt: row.lastRebuiltAt,
    lastUpdatedAt: row.lastUpdatedAt,
    version: row.version,
  };
}

function parseFeatures(raw: string): ProfileFeatures {
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileFeatures>;
    return {
      genres: asMap(parsed.genres),
      keywords: asMap(parsed.keywords),
      people: asMap(parsed.people),
      decades: asMap(parsed.decades),
      runtimes: asMap(parsed.runtimes),
      languages: asMap(parsed.languages),
    };
  } catch {
    return emptyFeatures();
  }
}

// fallow-ignore-next-line complexity
function asMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}
