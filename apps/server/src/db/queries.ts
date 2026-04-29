import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { plugins } from "./schema";

export async function selectEnabledPlugins() {
  const db = getDb();
  return db.select().from(plugins).where(eq(plugins.enabled, 1)).all();
}
