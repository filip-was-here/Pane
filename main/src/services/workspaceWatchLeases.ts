/** Longer than the maximum 120s long poll, including its cadence/idle re-parks. */
const WATCH_LEASE_MS = 125_000;

/** Owns a whole watch request, so takeover cannot revive a superseded cadence loop. */
export class WorkspaceWatchLeases {
  private readonly named = new Map<string, AbortController>();

  acquire(name?: string, connection?: AbortSignal) {
    connection?.throwIfAborted();
    const controller = new AbortController();
    if (name !== undefined) {
      this.named.get(name)?.abort(new Error('Workspace watch superseded by a new request for this cursor'));
      this.named.set(name, controller);
    }
    const disconnect = () => controller.abort(connection?.reason);
    const release = () => {
      connection?.removeEventListener('abort', disconnect);
      clearTimeout(timer);
      if (name !== undefined && this.named.get(name) === controller) this.named.delete(name);
    };
    const timer = setTimeout(() => {
      controller.abort(new Error('Workspace watch lease expired'));
      release();
    }, WATCH_LEASE_MS);
    timer.unref();
    controller.signal.addEventListener('abort', release, { once: true });
    connection?.addEventListener('abort', disconnect, { once: true });
    return { signal: controller.signal, release };
  }
}
