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
 * Minimal export surface this bridge consumes. Real Emscripten modules expose
 * far more (memory, malloc, etc.); the bridge only depends on what it calls.
 *
 * Naming/types are SSOT-aligned with `wasm_bridge.h` Wave 2 declarations.
 */
export interface WasmExports {
  // --- 64-bit clock (bigint required by WASM_BIGINT ABI) ---
  pal_wasm_advance_virtual_clock: (us: bigint) => void;
  pal_os_get_us: () => bigint;

  // --- Clock overflow early-warning (Wave2 P1 Task 6) ---
  /** Returns true once the virtual clock has crossed the 50% UINT64 threshold (~292 years). */
  pal_wasm_is_clock_warning_fired: () => boolean;
  /** Current virtual clock value, for the warning log payload. Bigint per WASM_BIGINT ABI. */
  pal_wasm_get_virtual_clock_us: () => bigint;

  // --- Fault setters (number-safe widths) ---
  pal_wasm_set_bounce_us: (us: number) => void;
  pal_wasm_set_warmup_us: (us: number) => void;
  pal_wasm_set_sample_interval_us: (us: number) => void;
  pal_wasm_set_adc_noise_v: (v: number) => void;
  pal_wasm_set_rc_tau_s: (s: number) => void;
  pal_wasm_set_i2c_drop_permil: (permil: number) => void;
  pal_wasm_set_prng_seed: (seed: number) => void;

  // --- Physical state management ---
  pal_wasm_reset_physical: () => void;
  pal_wasm_get_prng_state: () => number;

  // --- Degraded HAL surface (post-debounce / post-drop) ---
  pal_gpio_read: (pin: number) => boolean;

  /**
   * Simplified I²C transfer wrapper. The Emscripten-exported C symbol
   * `pal_i2c_transfer` actually takes pointers into linear memory; production
   * Worker code marshals via `Module._malloc` + `HEAPU8.set`. For unit
   * testability we expose a high-level shape and let real-Worker code wrap
   * the cwrap'd binding into this signature.
   */
  pal_i2c_transfer: (
    port: number,
    devAddr: number,
    writeBuf: Uint8Array,
    readLen: number,
  ) => boolean;
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
  /**
   * One-shot guard for the clock-overflow warning (Wave2 P1 Task 6). The
   * C-side flag (`s_clock_warning_fired`) is itself one-shot, but it remains
   * `true` for the rest of the wasm instance's life — without this JS-side
   * latch, every subsequent `advanceClock()` would re-emit the same warning.
   */
  private clockWarningEmitted: boolean = false;

  constructor(exports: WasmExports, injectGpioIdeal?: GpioIdealInjector) {
    this.exports = exports;
    this.injectGpioIdeal = injectGpioIdeal;
  }

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
    return this.exports.pal_gpio_read(pin);
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
   * Returns false on PRNG-driven drop or device-side NAK; true on success.
   */
  i2cTransfer(
    port: number,
    devAddr: number,
    writeBuf: Uint8Array,
    readLen: number,
  ): boolean {
    return this.exports.pal_i2c_transfer(port, devAddr, writeBuf, readLen);
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
