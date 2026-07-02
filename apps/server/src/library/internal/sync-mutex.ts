// Per-user mutex serializing membership sync so `tombstoneMissing`'s slow-path
// read-then-update is provably single-writer (design §Sync). Both writers —
// `library.sync` cron and eager `ensureSeeded` — funnel through it, closing the
// TOCTOU window that the seed marker alone never enforced (#911). Process-local:
// multi-instance would need Postgres advisory locks (out of scope for v1).
// fallow-ignore-next-line code-duplication
export class PerUserMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Runs `task` against the lock for `userId`, returning the task's result.
   * The lock is released as soon as `task` settles (success or rejection),
   * so a thrown error never deadlocks the next caller.
   */
  async run<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(userId) ?? Promise.resolve();
    // Slot only ever holds a rejection-swallowing `tracked` promise, so the
    // reject branch of `then(task, task)` is unreachable today; passing `task`
    // for both keeps the chain alive if a future caller stores a raw rejection.
    const next = previous.then(task, task);
    // Track the next-in-line promise (rejections swallowed so the chain stays
    // resolved). When this call drains, only clear the slot if it still points
    // at this chain — a later caller moved it forward and owns cleanup.
    const tracked = next.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(userId, tracked);
    try {
      return await next;
    } finally {
      if (this.chains.get(userId) === tracked) {
        this.chains.delete(userId);
      }
    }
  }
}

// Module-level singleton: one lock table shared by every membership-sync caller.
export const syncMutex = new PerUserMutex();
