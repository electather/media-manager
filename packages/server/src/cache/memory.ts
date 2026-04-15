import { LRUCache } from 'lru-cache'
import type { CacheProvider } from './types'

interface CacheEntry {
  value: string
}

/** In-memory LRU cache backed by lru-cache. Values are JSON-serialized for consistency with Redis. */
export class MemoryCache implements CacheProvider {
  private readonly cache: LRUCache<string, CacheEntry>

  constructor(maxSize = 500) {
    this.cache = new LRUCache<string, CacheEntry>({
      max: maxSize,
      ttlAutopurge: true,
    })
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    if (!entry) return null
    return JSON.parse(entry.value) as T
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.cache.set(key, { value: JSON.stringify(value) }, { ttl: ttlMs })
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.cache.clear()
      return
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }
}
