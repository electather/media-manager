import { useEffect, useState } from "react";

const IDLE_MS = 30_000;

interface CollectionLike {
  cleanup: () => Promise<void>;
}

interface Entry<T extends CollectionLike> {
  collection: T;
  refcount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface CollectionRegistry<T extends CollectionLike> {
  acquire: (key: string) => T;
  release: (key: string) => void;
  peek: (key: string) => T | null;
}

/**
 * Builds a per-key collection registry with refcounted, idle-deferred cleanup.
 * Mount acquires (cancelling pending cleanup); unmount releases and schedules
 * cleanup after IDLE_MS so a quick remount reuses the live instance.
 */
export function createCollectionRegistry<T extends CollectionLike>(
  factory: (key: string) => T,
): CollectionRegistry<T> {
  const cache = new Map<string, Entry<T>>();

  const acquire = (key: string): T => {
    let entry = cache.get(key);
    if (!entry) {
      entry = { collection: factory(key), refcount: 0, idleTimer: null };
      cache.set(key, entry);
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.refcount += 1;
    return entry.collection;
  };

  const release = (key: string): void => {
    const entry = cache.get(key);
    if (!entry) return;
    entry.refcount -= 1;
    if (entry.refcount > 0) return;
    entry.idleTimer = setTimeout(() => {
      const current = cache.get(key);
      if (!current || current.refcount > 0) return;
      cache.delete(key);
      void current.collection.cleanup();
    }, IDLE_MS);
  };

  const peek = (key: string): T | null => cache.get(key)?.collection ?? null;

  return { acquire, release, peek };
}

/**
 * Hook that holds a collection from a registry for the component's lifetime.
 * Returns null while the key is null. Safe under StrictMode double-mount via
 * the registry's idle-deferred cleanup.
 */
export function useCollection<T extends CollectionLike>(
  registry: CollectionRegistry<T>,
  key: string | null,
): T | null {
  const [collection, setCollection] = useState<T | null>(null);

  useEffect(() => {
    if (!key) {
      setCollection(null);
      return;
    }
    const next = registry.acquire(key);
    setCollection(next);
    return () => {
      registry.release(key);
    };
  }, [key, registry]);

  return collection;
}
