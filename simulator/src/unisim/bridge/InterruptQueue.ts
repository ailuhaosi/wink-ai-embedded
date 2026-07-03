/**
 * InterruptQueue — poll-model FIFO backing js_pal_poll_interrupt.
 *
 * Behind js_pal_register_interrupt / _deregister the host maintains a pin ->
 * (cbIdx, argPtr) map. External edge-detection code (e.g. PinArbiter listener
 * in Phase C) calls push(pin) when the pin transitions in a way the C-side
 * wanted to interrupt on. If a mapping exists, the (cbIdx, argPtr) tuple is
 * enqueued; otherwise the push is silently dropped (spurious-edge tolerant).
 *
 * Capacity + overflow: matches pal_wasm_internal.h C-side FIFO
 * (PAL_WASM_INTERRUPT_QUEUE_SIZE, default 16). Overflow policy: drop-oldest + console.warn.
 */
import { WasmInterruptQueue, PendingInterrupt } from '../types/wasm/interrupt-queue';

/**
 * JS-side FIFO capacity. Aligns with pal_wasm_internal.h
 * PAL_WASM_INTERRUPT_QUEUE_SIZE (default 16; CMake can override to 32).
 * Phase C: plumb this from a build-time constant if needed.
 */
export const INTERRUPT_QUEUE_CAPACITY = 16;

interface Mapping {
  cbIdx: number;
  argPtr: number;
}

export class InterruptQueue implements WasmInterruptQueue {
  private mappings = new Map<number, Mapping>();
  private queue: PendingInterrupt[] = [];
  private overflowWarned = false;

  register(pin: number, cbIdx: number, argPtr: number): void {
    this.mappings.set(pin, { cbIdx, argPtr });
  }

  deregister(pin: number): void {
    this.mappings.delete(pin);
  }

  push(pin: number): boolean {
    const m = this.mappings.get(pin);
    if (!m) return false;

    if (this.queue.length >= INTERRUPT_QUEUE_CAPACITY) {
      const dropped = this.queue.shift()!; // drop oldest
      if (!this.overflowWarned) {
        this.overflowWarned = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[InterruptQueue] FIFO overflow (capacity=${INTERRUPT_QUEUE_CAPACITY}); ` +
          `dropping oldest (cbIdx=${dropped.cbIdx}, argPtr=0x${dropped.argPtr.toString(16)}` +
          `, pin=${pin}). Further overflows on this instance will not be warned.`,
        );
      }
    }
    this.queue.push({ cbIdx: m.cbIdx, argPtr: m.argPtr });
    return true;
  }

  pop(): PendingInterrupt | null {
    return this.queue.shift() ?? null;
  }

  size(): number {
    return this.queue.length;
  }
}
