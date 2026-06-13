import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { customSessionClient } from "better-auth/client/plugins";
import type { Auth } from "@nama/server/api/router";

/** Better Auth React client, configured to reach the server's /api/auth endpoint. */
export const authClient = createAuthClient({
  plugins: [customSessionClient<Auth>(), oauthProviderClient()],
});
