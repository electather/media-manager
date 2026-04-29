import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import type { FeedbackAction, FeedbackRecord } from "@ent-mcp/shared/preferences";
import { getDb } from "../db/client";
import { feedback } from "../db/schema";
import { classifySentiment, extractNoteKeywords, type NoteSentiment } from "./sentiment";
import type { UserItemFeedback } from "./types";

export interface RecordFeedbackInput {
  userId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  action: FeedbackAction;
  rating?: number | null;
  note?: string | null;
  itemKeywords?: readonly string[];
  now?: number;
}

// fallow-ignore-next-line complexity
function processNoteFields(
  raw: string | null | undefined,
  itemKeywords: readonly string[],
  context: { userId: string; tmdbId: string },
): {
  note: string | null;
  noteSentiment: NoteSentiment | null;
  noteKeywordsJson: string | null;
  noteKeywordsArray: string[] | null;
} {
  const note = typeof raw === "string" && raw.length > 0 ? raw : null;
  if (!note)
    return { note: null, noteSentiment: null, noteKeywordsJson: null, noteKeywordsArray: null };
  const noteSentiment = classifySentiment(note);
  const keywords = extractNoteKeywords(note, itemKeywords);
  if (note.length > 20 && keywords.length === 0) {
    console.warn("[feedback-log] non-trivial note produced no keywords", {
      userId: context.userId,
      tmdbId: context.tmdbId,
      noteLength: note.length,
      itemKeywordCount: itemKeywords.length,
    });
  }
  const hasKeywords = keywords.length > 0;
  return {
    note,
    noteSentiment,
    noteKeywordsJson: hasKeywords ? JSON.stringify(keywords) : null,
    noteKeywordsArray: hasKeywords ? keywords : null,
  };
}

export const feedbackLog = {
  async record(input: RecordFeedbackInput): Promise<FeedbackRecord> {
    const createdAt = input.now ?? Date.now();
    const { note, noteSentiment, noteKeywordsJson, noteKeywordsArray } = processNoteFields(
      input.note,
      input.itemKeywords ?? [],
      { userId: input.userId, tmdbId: input.tmdbId },
    );
    const row = {
      id: randomUUID(),
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      action: input.action,
      rating: input.action === "rate" && typeof input.rating === "number" ? input.rating : null,
      note,
      noteSentiment,
      noteKeywords: noteKeywordsJson,
      createdAt,
    };
    await getDb().insert(feedback).values(row);
    return {
      id: row.id,
      userId: row.userId,
      tmdbId: row.tmdbId,
      mediaType: row.mediaType,
      action: row.action,
      rating: row.rating,
      note: row.note,
      noteSentiment: row.noteSentiment,
      noteKeywords: noteKeywordsArray,
      createdAt: row.createdAt,
    };
  },

  async readAllForUser(userId: string): Promise<FeedbackRecord[]> {
    const rows = await getDb()
      .select()
      .from(feedback)
      .where(eq(feedback.userId, userId))
      .orderBy(desc(feedback.createdAt))
      .all();
    return rows.map(toRecord);
  },

  async readSince(userId: string, sinceMs: number): Promise<FeedbackRecord[]> {
    const rows = await getDb()
      .select()
      .from(feedback)
      .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, sinceMs)))
      .orderBy(desc(feedback.createdAt))
      .all();
    return rows.map(toRecord);
  },

  async latestForItem(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<UserItemFeedback | null> {
    const rows = await getDb()
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.userId, userId),
          eq(feedback.tmdbId, tmdbId),
          eq(feedback.mediaType, mediaType),
        ),
      )
      .orderBy(desc(feedback.createdAt))
      .all();
    if (rows.length === 0) return null;
    return aggregateForItem(rows.map(toRecord));
  },

  async countSince(userId: string, sinceMs: number): Promise<number> {
    const rows = await getDb()
      .select({ id: feedback.id })
      .from(feedback)
      .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, sinceMs)))
      .all();
    return rows.length;
  },
};

function toRecord(row: typeof feedback.$inferSelect): FeedbackRecord {
  return {
    id: row.id,
    userId: row.userId,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    action: row.action,
    rating: row.rating,
    note: row.note,
    noteSentiment: row.noteSentiment,
    noteKeywords: parseKeywords(row.noteKeywords),
    createdAt: row.createdAt,
  };
}

function parseKeywords(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : null;
  } catch {
    return null;
  }
}

/** Collapses a list of records for one item into the ent_details projection. */
// fallow-ignore-next-line complexity
function aggregateForItem(records: FeedbackRecord[]): UserItemFeedback {
  const out: UserItemFeedback = {};
  const first = records[0];
  if (first) out.latestAt = first.createdAt;
  for (const record of records) {
    if (out.rated === undefined && record.action === "rate" && record.rating !== null) {
      out.rated = record.rating;
    }
    if (out.liked === undefined && (record.action === "like" || record.action === "dislike")) {
      out.liked = record.action === "like";
    }
    if (!out.noted && record.action === "note") out.noted = true;
  }
  return out;
}
