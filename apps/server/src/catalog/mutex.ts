/**
 * Process-local per-user mutex used to serialize append-only mirror writes
 * (V39). Concurrent calls for the same user queue behind one another via a
 * promise chain; calls for different users run independently. The mutex is
 * intentionally process-local — multi-instance deployments are out of
 * scope for v1 and would require Postgres advisory locks instead.
 */
export class PerUserMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Runs `task` against the lock for `userId`, returning the task's result.
   * The lock is released as soon as `task` settles (success or rejection),
   * so a thrown error never deadlocks the next caller.
   */
  async run<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(userId) ?? Promise.resolve();
    const next = previous.then(task, task);
    // Track the next-in-line promise (swallowed so the chain stays
    // unresolved on rejection). When this call drains, only clear the slot
    // if it still points at this very chain — a later caller will have
    // moved the slot forward and owns the cleanup.
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
