import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

/** Better Auth React client, configured to reach the server's /api/auth endpoint. */
export const authClient = createAuthClient({
  plugins: [oauthProviderClient()],
});
