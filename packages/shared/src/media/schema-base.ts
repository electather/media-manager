import { z } from "zod";
import { AVAILABILITY_STATUSES, MEDIA_TYPES } from "./enums";

export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const availabilityStatusSchema = z.enum(AVAILABILITY_STATUSES);
