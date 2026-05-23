/**
 * Per-user TTL cache shared by `tonight/section` (5 min) and `moods/cluster`
 * (30 s). Wraps a single `Map<key, { value, expiresAt }>` with bounded LRU
 * eviction so a long-running process can't leak entries. Used at module
 * scope; tests can call `__resetForTests()` to clear.
 */
const MAX_ENTRIES = 5000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class UserTtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, now: number = Date.now()): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    this.gc(now);
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  private gc(now: number): void {
    if (this.store.size < MAX_ENTRIES) return;
    for (const [k, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(k);
    }
    while (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
