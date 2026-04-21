import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../db/client";
import { feedback } from "../db/schema";
import { classifySentiment, extractNoteKeywords } from "./sentiment";
import type { FeedbackAction, FeedbackRecord, UserItemFeedback } from "./types";

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

export const feedbackLog = {
  async record(input: RecordFeedbackInput): Promise<FeedbackRecord> {
    const createdAt = input.now ?? Date.now();
    const note = typeof input.note === "string" && input.note.length > 0 ? input.note : null;
    const noteSentiment = note ? classifySentiment(note) : null;
    const noteKeywords = note ? extractNoteKeywords(note, input.itemKeywords ?? []) : null;
    if (note && note.length > 20 && (!noteKeywords || noteKeywords.length === 0)) {
      console.warn("[feedback-log] non-trivial note produced no keywords", {
        userId: input.userId,
        tmdbId: input.tmdbId,
        noteLength: note.length,
        itemKeywordCount: (input.itemKeywords ?? []).length,
      });
    }
    const row = {
      id: randomUUID(),
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      action: input.action,
      rating: input.action === "rate" && typeof input.rating === "number" ? input.rating : null,
      note,
      noteSentiment,
      noteKeywords: noteKeywords && noteKeywords.length > 0 ? JSON.stringify(noteKeywords) : null,
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
      noteKeywords: noteKeywords ?? null,
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
