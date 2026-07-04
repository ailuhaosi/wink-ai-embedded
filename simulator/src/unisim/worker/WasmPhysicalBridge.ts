/**
 * WasmPhysicalBridge.ts — JS ↔ WASM degradation/physical bridge (ADR-0009 Wave 2).
 *
 * Wraps the EMSCRIPTEN_KEEPALIVE exports declared in
 * `wink-micro-os/targets/wasm/wasm_bridge.h`. Strict type contract per
 * CMake `-s WASM_BIGINT=1`:
 *
 *   - uint64_t            ↔ bigint   (forced; passing `number` throws TypeError)
 *   - uint32_t / uint16_t ↔ number   (safe within 53-bit precision)
 *   - float               ↔ number   (IEEE-754 double demotes automatically)
 *
 * Keeping these alignments at the TS layer means a programmer mistake is caught
 * at compile time before it can manifest as an Emscripten boundary TypeError.
 */

import type { WasmExports } from '../types/wasm/exports';

/**
 * Minimal subset of the Emscripten Module needed for I²C marshalling and
 * host-fault string writing (P0-3). Structurally compatible with the
 * EmscriptenModuleLike interface from bridge/installUnisimBridge.ts.
 */
export interface RawModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

/**
 * Fault configuration payload. Field types mirror the C setter signatures
 * exactly so a one-to-one wire-up via `setFaults()` is the only sanctioned
 * way to push faults into WASM (no per-field setters exposed at the bridge
 * surface — keeps the JSON ↔ C correspondence auditable).
 */
export interface SimFaultsConfig {
  /** uint32_t — debounce window in µs. */
  bounce_us: number;
  /** uint32_t — sensor warm-up window in µs. */
  warmup_us: number;
  /** uint32_t — ADC sample interval in µs. */
  sample_interval_us: number;
  /** float — additive ADC noise in volts. */
  adc_noise_v: number;
  /** float — RC time-constant in seconds. */
  rc_tau_s: number;
  /** uint16_t — I²C drop rate in per-mille (0..1000). */
  i2c_drop_permil: number;
  /** uint32_t — PRNG seed; deterministic golden replay. */
  prng_seed: number;
}

/**
 * Optional hook fired when `setGpioIdeal` is invoked. The bridge holds the
 * authoritative ideal-level map (so unit tests can inspect / replay it), but
 * actual injection into WASM happens through whatever mechanism the host
 * chose (`globalThis.__wink_gpio_ideal` for EM_JS-injected mocks, a cwrap'd
 * exported setter, etc.). The host wires this callback at construction.
 */
export type GpioIdealInjector = (pin: number, level: boolean) => void;

export class WasmPhysicalBridge {
  private readonly exports: WasmExports;
  private readonly idealGpioStates: Map<number, boolean> = new Map();
  private readonly injectGpioIdeal?: GpioIdealInjector;
  private readonly rawModule: RawModule | null;
  /**
   * One-shot guard for the clock-overflow warning (Wave2 P1 Task 6). The
   * C-side flag (`s_clock_warning_fired`) is itself one-shot, but it remains
   * `true` for the rest of the wasm instance's life — without this JS-side
   * latch, every subsequent `advanceClock()` would re-emit the same warning.
   */
  private clockWarningEmitted: boolean = false;

  constructor(
    exports: WasmExports,
    injectGpioIdeal?: GpioIdealInjector,
    rawModule?: RawModule,
  ) {
    this.exports = exports;
    this.injectGpioIdeal = injectGpioIdeal;
    this.rawModule = rawModule ?? null;
  }

  /** Expose rawModule for createUnisimImports' reportHostFault closure (P0-3). */
  getRawModule(): RawModule | null { return this.rawModule; }

  /** Expose typed WasmExports for host-fault delivery and diagnostics.
   *  Use this instead of bracket- access or `as` casts in consuming code. */
  getExports(): WasmExports { return this.exports; }

  /** Push the full faults JSON payload into WASM in one shot. */
  setFaults(config: SimFaultsConfig): void {
    this.exports.pal_wasm_set_bounce_us(config.bounce_us);
    this.exports.pal_wasm_set_warmup_us(config.warmup_us);
    this.exports.pal_wasm_set_sample_interval_us(config.sample_interval_us);
    this.exports.pal_wasm_set_adc_noise_v(config.adc_noise_v);
    this.exports.pal_wasm_set_rc_tau_s(config.rc_tau_s);
    this.exports.pal_wasm_set_i2c_drop_permil(config.i2c_drop_permil);
    this.exports.pal_wasm_set_prng_seed(config.prng_seed);
  }

  /**
   * Record a pin's ideal (pre-degradation) level. Idempotent.
   * @param pin   GPIO pin number (any uint16; bridge does not enforce a max
   *              — pin OOB handling lives in `pal_wasm_get_debounce_ctx`,
   *              which returns NULL and the C HAL falls through to the
   *              ideal level. So setting any pin value here must not
   *              throw.).
   * @param level true = HIGH, false = LOW.
   */
  setGpioIdeal(pin: number, level: boolean): void {
    this.idealGpioStates.set(pin, level);
    if (this.injectGpioIdeal) {
      this.injectGpioIdeal(pin, level);
    }
  }

  /** Inspect the JS-side ideal cache (for tests / UI / replay). */
  getGpioIdeal(pin: number): boolean | undefined {
    return this.idealGpioStates.get(pin);
  }

  /** Read the post-degradation (debounced) pin level from WASM. */
  readGpioDegraded(pin: number): boolean {
    return this.exports.pal_wasm_gpio_read(pin);
  }

  /** Advance the WASM virtual clock. `us` must be bigint per WASM_BIGINT ABI. */
  advanceClock(us: bigint): void {
    if (us < 0n) {
      throw new RangeError(`advanceClock: us must be non-negative, got ${us}`);
    }
    this.exports.pal_wasm_advance_virtual_clock(us);

    // Wave2 P1 Task 6: poll the C-side one-shot overflow warning. The C flag
    // stays `true` for the rest of the instance lifetime, so we additionally
    // gate on a JS-side latch to keep this to a single `console.warn`.
    if (!this.clockWarningEmitted && this.exports.pal_wasm_is_clock_warning_fired()) {
      this.clockWarningEmitted = true;
      const clockUs = this.exports.pal_wasm_get_virtual_clock_us();
      // eslint-disable-next-line no-console
      console.warn(
        `[CLOCK] Virtual clock exceeded 292 years (${clockUs}us). ` +
          'Reset simulation soon to avoid uint64 overflow.',
      );
    }
  }

  /** Microsecond reading from the WASM-side `s_virtual_us`. */
  getClockUs(): bigint {
    return this.exports.pal_os_get_us();
  }

  /** Current PRNG state (for determinism assertions / golden compares). */
  getPrngState(): number {
    return this.exports.pal_wasm_get_prng_state();
  }

  /**
   * Issue an I²C transfer through the degraded HAL path (drop-rate honoured).
   * Marshals writeBuf into the wasm heap via _malloc/HEAPU8.set, invokes the
   * raw C ABI, copies the read buffer back out (P0-4: Phase C DTO extension
   * — previously the read buffer was freed without being returned, making
   * read-type I2C transactions (RTC/WHO_AM_I/ADC/IMU) completely unusable),
   * then _frees.
   *
   * Returns `{ ok: true, data: Uint8Array }` on success (data is a COPY of
   * wasm heap memory, safe to use after this call returns); `{ ok: false }`
   * on PRNG-driven drop or device-side NAK.
   *
   * NOTE: uses HEAPU8.slice() (COPY), not .subarray() (view) — rbufPtr is
   * _free()'d immediately after, so a view would be overwritten by a
   * subsequent malloc.
   */
  i2cTransfer(
    port: number,
    devAddr: number,
    writeBuf: Uint8Array,
    readLen: number,
  ): { ok: boolean; data?: Uint8Array } {
    const m = this.rawModule;
    if (!m) {
      // Testing path where exports are mocked but the Module isn't wired
      // through — return {ok: boolean} matching the mock's boolean-return shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockOk = (this.exports as any).pal_wasm_i2c_transfer(port, devAddr, writeBuf, readLen);
      return { ok: Boolean(mockOk) };
    }
    const wlen = writeBuf.length;
    const wbufPtr = wlen > 0 ? m._malloc(wlen) : 0;
    const rbufPtr = readLen > 0 ? m._malloc(readLen) : 0;
    try {
      if (wlen > 0) m.HEAPU8.set(writeBuf, wbufPtr);
      const ok = this.exports.pal_wasm_i2c_transfer(
        port, devAddr, wbufPtr, wlen, rbufPtr, readLen,
      );
      if (!ok) return { ok: false };
      if (readLen > 0 && rbufPtr) {
        // COPY (slice), not view — _free runs immediately after.
        return { ok: true, data: m.HEAPU8.slice(rbufPtr, rbufPtr + readLen) };
      }
      return { ok: true };
    } finally {
      if (wbufPtr) m._free(wbufPtr);
      if (rbufPtr) m._free(rbufPtr);
    }
  }

  /** Reset all fault state, debounce contexts, and PRNG to seed=1. */
  reset(): void {
    this.exports.pal_wasm_reset_physical();
    this.idealGpioStates.clear();
    // The C-side warning flag itself is BSS-zero-initialised on a fresh wasm
    // instance. The TS latch is local to this bridge; clear it so a follow-up
    // reset+long-run could re-emit the warning if it ever re-fires.
    this.clockWarningEmitted = false;
  }
}
