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
 * Capacity + drop-oldest overflow policy matches pal_wasm_internal.h C-side
 * FIFO (concrete number filled in by Task 10 implementation).
 */
export interface PendingInterrupt {
  cbIdx: number;
  argPtr: number;
}

export interface WasmInterruptQueue {
  /** Register the (cbIdx, argPtr) mapping for a pin. Idempotent — later
   *  registrations overwrite. Does NOT enqueue anything. */
  register(pin: number, cbIdx: number, argPtr: number): void;

  /** Remove the mapping. Idempotent (deregister on unknown pin is a no-op). */
  deregister(pin: number): void;

  /** Enqueue a pending interrupt for `pin`. If `pin` has no registered
   *  mapping this is a silent no-op (spurious-edge tolerant). Returns
   *  `true` if the interrupt was enqueued, `false` if dropped. */
  push(pin: number): boolean;

  /** Pop the oldest pending interrupt, or null if the queue is empty. */
  pop(): PendingInterrupt | null;

  /** Current queued count (for tests / diagnostics). */
  size(): number;
}
