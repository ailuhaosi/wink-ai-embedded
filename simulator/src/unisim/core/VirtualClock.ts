/**
 * VirtualClock.ts — JS-side virtual clock (ADR-0009 Wave 2).
 *
 * Mirrors the WASM-side `s_virtual_us` uint64_t counter. All 64-bit surface is
 * `bigint` to match the `-sWASM_BIGINT=1` ABI (passing `number` to a bigint-typed
 * Emscripten export throws `TypeError`).
 *
 * Phase B addition: pending sleep queue (§5.3 of the tech spec) with TWO entry
 * points at different precisions:
 *
 *   sleep(ms: number)   — ms-precision wrapper for js_pal_os_sleep_ms
 *   sleepUs(us: bigint) — µs-precision primitive for js_pal_os_busy_wait_us.
 *                         MUST NOT be truncated to ms; I²C bit-banging /
 *                         one-wire / servo pulses all rely on sub-ms accuracy.
 *
 * Enqueue semantics (Global Constraint "sleep(0) and sleepUs(0n) still wait"):
 * we clamp the delta to `>= 1n` so wakeAt = now + max(us, 1n). A zero-delay
 * sleep therefore does NOT resolve on advance(0n) — SimWorker startup /
 * event-drain code can call advance(0n) freely without flushing in-flight
 * busy_wait_us(500) promises.
 *
 * Reset semantics (Global Constraint "reset() rejects pending sleeps"): reset()
 * REJECTS every pending sleep with VirtualClockResetError instead of dropping
 * them silently. A wasm coroutine mid-Asyncify-unwind at reset time surfaces
 * the failure — a stale wasm instance can never enter a zombie "never rewinds"
 * state without producing a diagnostic. Callers that intentionally throw away
 * pending work MUST swallow the rejection with `.catch(() => {})`.
 */

/**
 * Thrown into pending sleep promises when reset() is called. Callers can
 * `instanceof`-narrow to distinguish reset from real errors.
 */
export class VirtualClockResetError extends Error {
  constructor() {
    super('VirtualClock was reset while a sleep was pending');
    this.name = 'VirtualClockResetError';
  }
}

interface PendingSleep {
  wakeAt: bigint;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class VirtualClock {
  private us: bigint = 0n;
  private pending: PendingSleep[] = [];

  /**
   * DEBUG-only re-entry guard. Set to `true` during the synchronous portion of
   * `advance()`; cleared by a queued microtask so that subsequent advances in
   * a later macrotask / after an `await Promise.resolve()` are permitted.
   *
   * Production builds strip the guard via `NODE_ENV !== 'development'` so that
   * bundlers can tree-shake the bookkeeping away.
   */
  private _advancing = false;

  /** Advance the clock by `us` microseconds and resolve any pending sleeps
   *  whose `wakeAt <= this.us`, in ascending-wakeAt order.
   *
   *  IMPORTANT: callers MUST call advance() only ONCE per synchronous block,
   *  then yield the microtask queue before the next call. See Global Constraint
   *  "advance() single-tick-per-sync-block convention" for rationale.
   *
   *  In dev mode this invariant is enforced at runtime: a synchronous re-entry
   *  (e.g. a sleep `.then()` that synchronously calls advance() again) throws
   *  an Error so the bug surfaces immediately instead of corrupting virtual
   *  time ordering.
   *
   *  Complexity: O(N log N) where N = pending.length. This is fine for Phase B
   *  (N < 10 typical). Phase C: if FreeRTOS multi-task simulation pushes N > 50
   *  routinely, migrate to a binary heap (O(log N) insert in sleepUs, O(1)
   *  pop-min here). */
  advance(us: bigint): void {
    if (us < 0n) {
      throw new RangeError(`VirtualClock.advance: us must be non-negative, got ${us}`);
    }
    // Re-entry guard (dev-mode only) — P1-2
    if (
      typeof process !== 'undefined' &&
      process.env &&
      process.env.NODE_ENV === 'development'
    ) {
      if (this._advancing) {
        throw new Error(
          '[VirtualClock] advance() re-entered in the same synchronous block; ' +
            'yield the microtask queue (await Promise.resolve()) before the next ' +
            'advance() to preserve virtual-time causal ordering.',
        );
      }
      this._advancing = true;
      // Microtask-latched reset: clears after the current macrotask's microtask
      // queue is drained, which is exactly the boundary at which a second
      // advance() becomes legal.
      queueMicrotask(() => {
        this._advancing = false;
      });
    }
    this.us += us;
    if (this.pending.length === 0) return;

    const due: PendingSleep[] = [];
    const keep: PendingSleep[] = [];
    for (const p of this.pending) {
      if (p.wakeAt <= this.us) due.push(p);
      else keep.push(p);
    }
    due.sort((a, b) => (a.wakeAt < b.wakeAt ? -1 : a.wakeAt > b.wakeAt ? 1 : 0));
    this.pending = keep;
    for (const p of due) p.resolve();
  }

  /** Microsecond reading; aligns with C-side `pal_os_get_us()`. */
  getUs(): bigint {
    return this.us;
  }

  /** Millisecond reading; aligns with C-side `pal_os_get_ms()` (integer division). */
  getMs(): bigint {
    return this.us / 1000n;
  }

  /**
   * Return a Promise that resolves once the clock advances by AT LEAST
   * `ms * 1000` microseconds from the enqueue-time cursor. Delegates to
   * sleepUs; `sleep(0)` therefore behaves per the sleepUs(0n) rule (see below).
   */
  sleep(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) {
      return Promise.reject(new RangeError(`VirtualClock.sleep: ms must be a non-negative finite number, got ${ms}`));
    }
    return this.sleepUs(BigInt(Math.floor(ms)) * 1000n);
  }

  /**
   * µs-precision primitive. Enqueue-only; the host driver must call `advance()`
   * for progress. `sleepUs(0n)` still waits: wakeAt is clamped to `now + 1n`
   * so a subsequent `advance(0n)` does NOT flush the sleep — only `advance(us)`
   * with `us > 0n` (equivalent to actual simulated time passing) will.
   */
  sleepUs(us: bigint): Promise<void> {
    if (us < 0n) {
      throw new RangeError(`VirtualClock.sleepUs: us must be non-negative bigint, got ${us}`);
    }
    const delta = us > 0n ? us : 1n;
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ wakeAt: this.us + delta, resolve, reject });
    });
  }

  /**
   * Reset the clock to zero and REJECT every pending sleep with
   * VirtualClockResetError. See class-level doc for rationale (loud failure
   * over silent-zombie wasm instances). Callers that intentionally drop
   * pending work should `.catch(() => {})` on the sleep promise.
   */
  reset(): void {
    this.us = 0n;
    const toReject = this.pending;
    this.pending = [];
    const err = new VirtualClockResetError();
    for (const p of toReject) p.reject(err);
  }
}
