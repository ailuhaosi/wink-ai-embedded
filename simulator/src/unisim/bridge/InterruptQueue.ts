/**
 * InterruptQueue — poll-model FIFO backing js_pal_poll_interrupt.
 *
 * Behind js_pal_register_interrupt / _deregister the host maintains a pin ->
 * (cbIdx, argPtr) map. External edge-detection code (e.g. PinArbiter listener
 * in Phase C) calls push(pin) when the pin transitions in a way the C-side
 * wanted to interrupt on. If a mapping exists, the (pin, cbIdx, argPtr) tuple
 * is enqueued; otherwise the push is silently dropped (spurious-edge tolerant).
 *
 * P1-3 (overflow redesign):
 *   - Queue elements now carry `pin` so drop warnings identify the *dropped*
 *     interrupt (previously the warning named the incoming pin, which was
 *     misleading when the storm came from the dropped pin).
 *   - Default policy is `'drop-newest'`: start-condition edges (typically
 *     the oldest entry) are preserved, while high-frequency spurious edges
 *     (newest) are discarded. Configurable via options.overflowPolicy for
 *     level-type interrupts where latest value matters.
 *   - Warnings are rate-limited (default 1s window) and report aggregated
 *     drop count since last warning, so interrupt storms don't flood the
 *     console. `overflowCount` is exposed for UI "IRQ storm" indicators.
 *
 * Capacity default matches pal_wasm_internal.h C-side FIFO
 * (PAL_WASM_INTERRUPT_QUEUE_SIZE = 16).
 */
import {
  WasmInterruptQueue,
  PendingInterrupt,
  InterruptQueueOptions,
  InterruptOverflowPolicy,
} from '../types/wasm/interrupt-queue';

/**
 * JS-side FIFO default capacity. Aligns with pal_wasm_internal.h
 * PAL_WASM_INTERRUPT_QUEUE_SIZE (default 16; CMake can override to 32).
 * Phase C: plumb this from a build-time constant if needed.
 */
export const INTERRUPT_QUEUE_CAPACITY = 16;

const DEFAULT_WARN_INTERVAL_MS = 1000;
const DEFAULT_POLICY: InterruptOverflowPolicy = 'drop-newest';

interface Mapping {
  cbIdx: number;
  argPtr: number;
}

export class InterruptQueue implements WasmInterruptQueue {
  private mappings = new Map<number, Mapping>();
  private queue: PendingInterrupt[] = [];
  private readonly capacity: number;
  private readonly overflowPolicy: InterruptOverflowPolicy;
  private readonly warnIntervalMs: number;
  private _overflowCount = 0;
  private dropsSinceLastWarn = 0;
  private lastWarnTime = 0;

  constructor(opts: InterruptQueueOptions = {}) {
    this.capacity = opts.capacity ?? INTERRUPT_QUEUE_CAPACITY;
    this.overflowPolicy = opts.overflowPolicy ?? DEFAULT_POLICY;
    this.warnIntervalMs = opts.warnIntervalMs ?? DEFAULT_WARN_INTERVAL_MS;
  }

  get overflowCount(): number {
    return this._overflowCount;
  }

  resetOverflowCount(): void {
    this._overflowCount = 0;
    this.dropsSinceLastWarn = 0;
    this.lastWarnTime = 0;
  }

  register(pin: number, cbIdx: number, argPtr: number): void {
    this.mappings.set(pin, { cbIdx, argPtr });
  }

  deregister(pin: number): void {
    this.mappings.delete(pin);
  }

  push(pin: number): boolean {
    const m = this.mappings.get(pin);
    if (!m) return false;

    if (this.queue.length >= this.capacity) {
      this._overflowCount++;
      this.dropsSinceLastWarn++;

      if (this.overflowPolicy === 'drop-newest') {
        // Drop the incoming interrupt (do not enqueue). Preserve oldest —
        // start-condition edges are typically state-machine-critical.
        this.maybeWarn(pin);
        return false;
      }

      // drop-oldest: evict the head, then enqueue the incoming as before.
      const dropped = this.queue.shift()!;
      this.maybeWarn(dropped.pin);
    }

    this.queue.push({ pin, cbIdx: m.cbIdx, argPtr: m.argPtr });
    return true;
  }

  pop(): PendingInterrupt | null {
    return this.queue.shift() ?? null;
  }

  size(): number {
    return this.queue.length;
  }

  private maybeWarn(droppedPin: number): void {
    if (this.warnIntervalMs <= 0) {
      this.emitWarn(droppedPin);
      this.dropsSinceLastWarn = 0;
      return;
    }
    const now = Date.now();
    if (now - this.lastWarnTime < this.warnIntervalMs) return;
    this.lastWarnTime = now;
    this.emitWarn(droppedPin);
    this.dropsSinceLastWarn = 0;
  }

  private emitWarn(lastDroppedPin: number): void {
    // eslint-disable-next-line no-console
    console.warn(
      `[InterruptQueue] FIFO overflow (policy=${this.overflowPolicy}, ` +
        `capacity=${this.capacity}); dropped ${this.dropsSinceLastWarn} ` +
        `interrupt(s) since last report; last dropped pin=${lastDroppedPin}, ` +
        `queue depth=${this.queue.length}. ` +
        `Total overflow drops this instance: ${this._overflowCount}.`,
    );
  }
}
