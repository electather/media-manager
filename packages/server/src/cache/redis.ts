import Redis from "ioredis";
import type { CacheProvider } from "./types";

/** Redis-backed cache. Uses PSETEX for TTL and SCAN+DEL for prefix clearing. */
export class RedisCache implements CacheProvider {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url);
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.client.psetex(key, ttlMs, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      await this.client.flushdb();
      return;
    }

    // Use SCAN to avoid blocking with KEYS.
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== "0");
  }
}
