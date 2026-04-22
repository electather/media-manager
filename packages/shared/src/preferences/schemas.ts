import { z } from "zod";
import { CONFIDENCE_LEVELS, FEEDBACK_ACTIONS, NOTE_SENTIMENTS, PROFILE_MEDIA_TYPES } from "./enums";

export const profileMediaTypeSchema = z.enum(PROFILE_MEDIA_TYPES);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const feedbackActionSchema = z.enum(FEEDBACK_ACTIONS);
export const noteSentimentSchema = z.enum(NOTE_SENTIMENTS);

/** Query for `GET /api/preferences/profile`. */
export const profileQuerySchema = z.object({
  mediaType: profileMediaTypeSchema.default("combined"),
});
export type ProfileQuery = z.infer<typeof profileQuerySchema>;
