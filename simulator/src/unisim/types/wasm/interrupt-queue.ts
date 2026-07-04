/**
 * WasmInterruptQueue — JS-side FIFO backing the poll-model interrupt bridge.
 *
 * Ties into wasm_bridge.h js_pal_register_interrupt / _deregister / _poll:
 *   register(pin, cbIdx, argPtr) — wasm hands JS the (cb, arg) mapping at
 *     ISR-installation time; JS stores it against `pin`.
 *   deregister(pin) — clear the mapping.
 *   push(pin) — external world (PinArbiter edge detector, timer, etc.) calls
 *     when an interrupt fires; if `pin` has a registered mapping, enqueue its
 *     (cb, arg) tuple; otherwise drop silently (spurious edge, no callback).
 *   pop() — wasm polls at tick boundaries via js_pal_poll_interrupt. Returns
 *     the oldest pending tuple, or null if empty.
 *
 * Overflow policy (default `'drop-newest'`, P1-3):
 *   - `'drop-newest'`: on overflow the *incoming* interrupt is dropped
 *     (spurious-edge/high-frequency-storm safe; preserves start-condition
 *     edges which are usually critical to state machines).
 *   - `'drop-oldest'`: legacy behavior — drop the head; useful for level-type
 *     interrupts where the latest value is the one that matters.
 *
 * Warnings are rate-limited (at most once per time window) and include the
 * pin of the *dropped* interrupt (not the incoming one), plus a running
 * overflow counter accessible via `overflowCount` for UI storm indicators.
 */
export interface PendingInterrupt {
  /** Source pin that triggered the interrupt (P1-3: added for diagnostics). */
  pin: number;
  cbIdx: number;
  argPtr: number;
}

export type InterruptOverflowPolicy = 'drop-oldest' | 'drop-newest';

export interface InterruptQueueOptions {
  /** Default: `'drop-newest'`. */
  overflowPolicy?: InterruptOverflowPolicy;
  /**
   * Minimum wall-clock interval between aggregated overflow warnings, in ms.
   * Default 1000ms. Set to 0 to warn on every overflow (noisy).
   */
  warnIntervalMs?: number;
  /** FIFO capacity; defaults to INTERRUPT_QUEUE_CAPACITY (16). */
  capacity?: number;
}

export interface WasmInterruptQueue {
  /** Register the (cbIdx, argPtr) mapping for a pin. Idempotent — later
   *  registrations overwrite. Does NOT enqueue anything. */
  register(pin: number, cbIdx: number, argPtr: number): void;

  /** Remove the mapping. Idempotent (deregister on unknown pin is a no-op). */
  deregister(pin: number): void;

  /** Enqueue a pending interrupt for `pin`. If `pin` has no registered
   *  mapping this is a silent no-op (spurious-edge tolerant). Returns
   *  `true` if the interrupt was enqueued, `false` if dropped (no mapping
   *  OR overflow with drop-newest policy). */
  push(pin: number): boolean;

  /** Pop the oldest pending interrupt, or null if the queue is empty. */
  pop(): PendingInterrupt | null;

  /** Current queued count (for tests / diagnostics). */
  size(): number;

  /** Total number of interrupts dropped due to FIFO overflow since
   *  construction (or last resetOverflowCount). */
  readonly overflowCount: number;

  /** Reset the overflow counter (e.g. on simulation reset). */
  resetOverflowCount(): void;
}
