import { z } from "zod";

/** Body for `POST /api/bootstrap/claim`. */
export const bootstrapClaimSchema = z.object({
  // The server issues `randomBytes(32).toString("base64url")` — always exactly 43
  // base64url characters. Matching that shape lets the client reject typos,
  // truncated copies, or pasted URLs before the round-trip.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
});
export type BootstrapClaimBody = z.infer<typeof bootstrapClaimSchema>;
