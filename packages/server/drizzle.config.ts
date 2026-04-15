import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: process.env["DB_PROVIDER"] === "postgres" ? "postgresql" : "sqlite",
  dbCredentials:
    process.env["DB_PROVIDER"] === "postgres"
      ? { url: process.env["DATABASE_URL"] ?? "" }
      : { url: process.env["SQLITE_PATH"] ?? "./data/ent-mcp.db" },
});
