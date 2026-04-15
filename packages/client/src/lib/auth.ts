import { createAuthClient } from "better-auth/react";

/** Better Auth React client, configured to reach the server's /api/auth endpoint. */
export const authClient = createAuthClient();
