// Per-user mutex for serializing append-only mirror writes (V39). Same user queues
// via promise chain; different users run parallel. Process-local by design: multi-instance
// would require Postgres advisory locks (out of scope for v1).
export class PerUserMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Runs `task` against the lock for `userId`, returning the task's result.
   * The lock is released as soon as `task` settles (success or rejection),
   * so a thrown error never deadlocks the next caller.
   */
  async run<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(userId) ?? Promise.resolve();
    // The slot only ever holds a `tracked` promise that swallows
    // rejections (see below), so the rejection branch of `then(task, task)`
    // is currently unreachable. We pass `task` for both branches so that
    // if a future caller stores a raw rejecting promise, the next link
    // still runs instead of deadlocking on the prior failure.
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
