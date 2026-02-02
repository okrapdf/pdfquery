/**
 * PDFEventEmitter
 *
 * Zero-dependency typed event emitter with late listener support.
 * Events are just strings — no fixed enum. Fire whatever you want.
 *
 * Late listeners (jQuery behavior): If the event already fired,
 * the listener runs immediately with the cached result.
 * Like $(document).ready(fn) after DOM is already parsed.
 */

export type EventListener = (...args: unknown[]) => void;

export class PDFEventEmitter {
  private listeners = new Map<string, EventListener[]>();
  private firedCache = new Map<string, unknown[]>();

  /**
   * Register a listener. If event already fired, runs immediately
   * with cached args (jQuery late-listener behavior).
   */
  on(event: string, fn: EventListener): this {
    // Late listener — event already fired, run immediately
    if (this.firedCache.has(event)) {
      try {
        fn(...this.firedCache.get(event)!);
      } catch (err) {
        this.emitError(err);
      }
      // Still register for future emissions
    }

    const arr = this.listeners.get(event) || [];
    arr.push(fn);
    this.listeners.set(event, arr);
    return this;
  }

  /**
   * Register a one-time listener. Removed after first invocation.
   * Also supports late-listener behavior.
   */
  once(event: string, fn: EventListener): this {
    const wrapper: EventListener = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove a specific listener, or all listeners for an event.
   */
  off(event: string, fn?: EventListener): this {
    if (!fn) {
      this.listeners.delete(event);
      return this;
    }
    const arr = this.listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) this.listeners.delete(event);
    }
    return this;
  }

  /**
   * Emit an event. Caches args for late listeners.
   */
  emit(event: string, ...args: unknown[]): this {
    this.firedCache.set(event, args);
    const arr = this.listeners.get(event);
    if (arr) {
      for (const fn of [...arr]) {
        try {
          fn(...args);
        } catch (err) {
          if (event !== 'error') {
            this.emitError(err);
          }
        }
      }
    }
    return this;
  }

  /**
   * Check if an event has been emitted at least once.
   */
  hasFired(event: string): boolean {
    return this.firedCache.has(event);
  }

  /**
   * Clear the fired cache for an event (or all events).
   */
  clearCache(event?: string): this {
    if (event) {
      this.firedCache.delete(event);
    } else {
      this.firedCache.clear();
    }
    return this;
  }

  /**
   * Remove all listeners and clear cache.
   */
  removeAllListeners(): this {
    this.listeners.clear();
    this.firedCache.clear();
    return this;
  }

  private emitError(err: unknown): void {
    if (this.listeners.has('error')) {
      this.emit('error', err);
    }
  }
}
