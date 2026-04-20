import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { preferenceProfiles } from "../db/schema";
import {
  deriveConfidence,
  emptyFeatures,
  type PreferenceProfile,
  type ProfileFeatures,
  type ProfileMediaType,
} from "./types";

export const profileStorage = {
  async read(userId: string, mediaType: ProfileMediaType): Promise<PreferenceProfile | null> {
    const row = await getDb()
      .select()
      .from(preferenceProfiles)
      .where(
        and(eq(preferenceProfiles.userId, userId), eq(preferenceProfiles.mediaType, mediaType)),
      )
      .get();
    if (!row) return null;
    return toProfile(row);
  },

  async write(profile: PreferenceProfile): Promise<void> {
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
    };
    await getDb()
      .insert(preferenceProfiles)
      .values(payload)
      .onConflictDoUpdate({
        target: [preferenceProfiles.userId, preferenceProfiles.mediaType],
        set: {
          features: payload.features,
          sampleSize: payload.sampleSize,
          confidence: payload.confidence,
          lastRebuiltAt: payload.lastRebuiltAt,
          lastUpdatedAt: payload.lastUpdatedAt,
        },
      });
  },
};

function toProfile(row: typeof preferenceProfiles.$inferSelect): PreferenceProfile {
  return {
    userId: row.userId,
    mediaType: row.mediaType,
    features: parseFeatures(row.features),
    sampleSize: row.sampleSize,
    confidence: row.confidence,
    lastRebuiltAt: row.lastRebuiltAt,
    lastUpdatedAt: row.lastUpdatedAt,
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

function asMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}
