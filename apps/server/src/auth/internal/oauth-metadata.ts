import { createAuthClient } from "better-auth/client";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { auth } from "./config";
import { env } from "../../env";

const serverClient = createAuthClient({
  plugins: [oauthProviderResourceClient()],
});

/** RFC 8414 Authorization Server Metadata handler. */
export const oauthAuthorizationServerHandler = oauthProviderAuthServerMetadata(auth);

/** RFC 9728 OAuth Protected Resource Metadata handler. */
export async function oauthProtectedResourceHandler(_req: Request): Promise<Response> {
  const metadata = await serverClient.getProtectedResourceMetadata({
    resource: env.BETTER_AUTH_URL,
    authorization_servers: [env.BETTER_AUTH_URL],
  });
  return new Response(JSON.stringify(metadata), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
    },
  });
}
