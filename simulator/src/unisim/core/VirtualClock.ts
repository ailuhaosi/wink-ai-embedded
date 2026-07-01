/**
 * VirtualClock.ts — JS-side virtual clock (ADR-0009 Wave 2)
 *
 * Mirrors the WASM-side `s_virtual_us` (uint64_t monotonic microsecond counter
 * declared in `wink-micro-os/targets/wasm/pal_osal_wasm.c`). The two clocks are
 * never directly compared in production — the WASM clock is authoritative for
 * `pal_os_get_us()`/`pal_os_get_ms()` consumers inside the sandbox — but the JS host
 * holds an equivalent view so the Worker can:
 *   1. Decide when to call `pal_wasm_advance_virtual_clock(us: bigint)` and by
 *      how much (delta accounting / scheduling).
 *   2. Drive timeline-replay UI without bouncing every query into WASM.
 *
 * Type contract (CMake `-s WASM_BIGINT=1`):
 *   - uint64_t  ↔ JS bigint   (this class enforces bigint throughout)
 *   - uint32_t  ↔ JS number   (used elsewhere; not here)
 *
 * All public surface is `bigint`. Implicit `number` coercion is rejected at the
 * type-system layer (callers must pass a literal `bigint` such as `1000n` or
 * convert with `BigInt(x)` explicitly). This matches the Emscripten BigInt
 * ABI: passing `number` to a `bigint`-typed export throws `TypeError`, so
 * keeping the JS-side clock strictly bigint prevents drift before it reaches
 * the WASM boundary.
 */
export class VirtualClock {
  private us: bigint = 0n;

  /** Advance the clock by `us` microseconds. `us` MUST be non-negative bigint. */
  advance(us: bigint): void {
    if (us < 0n) {
      throw new RangeError(`VirtualClock.advance: us must be non-negative, got ${us}`);
    }
    this.us += us;
  }

  /** Microsecond reading; aligns with C-side `pal_os_get_us()`. */
  getUs(): bigint {
    return this.us;
  }

  /** Millisecond reading; aligns with C-side `pal_os_get_ms()` (integer division). */
  getMs(): bigint {
    return this.us / 1000n;
  }

  /** Reset to zero. Mirrors `pal_wasm_reset_physical()` on the WASM side for
   *  fault state but the clock reset is a separate concern — call both when a
   *  full simulator rewind is required. */
  reset(): void {
    this.us = 0n;
  }
}
