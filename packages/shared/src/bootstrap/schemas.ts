import { z } from "zod";

/** Body for `POST /api/bootstrap/claim`. */
export const bootstrapClaimSchema = z.object({
  token: z.string().min(1),
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
});
export type BootstrapClaimBody = z.infer<typeof bootstrapClaimSchema>;
