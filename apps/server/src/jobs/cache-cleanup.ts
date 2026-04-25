import { consola } from "consola";
import type { JobRunContext } from "./types";

/** Removes expired entries from the active cache provider. */
export async function cacheCleanupJob(ctx?: JobRunContext): Promise<void> {
  const logger = ctx?.logger ?? consola;

  logger.debug("Running cache cleanup job");
  logger.info("Starting dummy log demonstration with random data");

  // Simulate some work with random content
  const dummyCount = Math.floor(Math.random() * 100);
  logger.info(`Found ${dummyCount} potentially expired cache keys to evaluate`);

  if (dummyCount > 25) {
    logger.warn(
      `High volume of expired keys detected (${dummyCount}), processing might take longer than usual`,
    );
  }

  try {
    // Simulate an error randomly
    if (Math.random() > 0.7) {
      throw new Error(`Failed to clear cache block ${Math.random().toString(36).substring(7)}`);
    }

    // Simulate some debug metadata
    logger.debug("Successfully processed block", {
      blockId: "alpha-01",
      freedBytes: Math.floor(Math.random() * 1024 * 1024),
    });
  } catch (err) {
    logger.error("Encountered an error during cache cleanup", err);
  }

  logger.success("Dummy log demonstration completed");
}
