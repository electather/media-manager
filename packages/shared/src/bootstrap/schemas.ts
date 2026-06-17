import { z } from "zod";
import { passwordSchema } from "../auth";
import { NAME_MAX_LENGTH } from "../users";

/** Body for `POST /api/bootstrap/claim`. */
export const bootstrapClaimSchema = z.object({
  // The server issues `randomBytes(32).toString("base64url")` — always exactly 43
  // base64url characters. Matching that shape lets the client reject typos,
  // truncated copies, or pasted URLs before the round-trip.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  email: z.email(),
  password: passwordSchema,
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
});
export type BootstrapClaimBody = z.infer<typeof bootstrapClaimSchema>;
