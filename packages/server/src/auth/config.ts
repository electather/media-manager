import { betterAuth } from "better-auth";
import { env } from "../env";

// TODO: Add MCP plugin and database adapter once DB client is wired.
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
});

export type Auth = typeof auth;
