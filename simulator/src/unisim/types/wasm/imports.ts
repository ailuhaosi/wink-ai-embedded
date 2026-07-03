/**
 * WasmImports — JS -> wasm import boundary contract.
 *
 * SSOT: `wink-micro-os/targets/wasm/wasm_bridge.h` `extern js_*` declarations.
 * Signature drift is caught at compile time by consumers (createUnisimImports
 * must produce a WasmImports; installUnisimBridge must assign every field)
 * and at test time by `__tests__/ssotAlignment.test.ts` which parses the
 * header and compares keys.
 *
 * ABI rules encoded here (WASM_BIGINT=1, Asyncify):
 *   - uint64_t  <-> bigint  (js_pal_os_get_ms / _us)
 *   - uint16_t / uint32_t / uint8_t <-> number
 *   - float     <-> number
 *   - bool      <-> boolean
 *   - pointer   <-> number (wasm-heap byte offset)
 *   - Asyncify import (sleep_ms / busy_wait_us) MUST return Promise<void>;
 *     returning `undefined` triggers a silent Asyncify unwind->rewind loop
 *     with no diagnostic (spike #8 in ADR-0019). This type is the only
 *     compile-time defense.
 */
export interface WasmImports {
  // --- PAL HAL ---
  js_pal_gpio_write(pin: number, level: boolean): void;
  js_pal_gpio_read(pin: number): boolean;
  /** duty is a percent (0..100 float), matching C `float duty_cycle_percent`. */
  js_pal_pwm_set_duty(channel: number, duty: number): void;
  /**
   * wbuf / rbuf are wasm linear-memory byte offsets, NOT ArrayBuffer views.
   * createUnisimImports() marshals them via `memoryView()` (see UnisimBridgeDeps).
   * Kept ptr+len to make SSOT alignment against wasm_bridge.h mechanical.
   */
  js_pal_i2c_transfer(
    port: number,
    addr: number,
    wbuf: number,
    wlen: number,
    rbuf: number,
    rlen: number,
  ): boolean;

  // --- Interrupt bridge (poll model, ADR-0002 Plan C) ---
  js_pal_register_interrupt(pin: number, cbIdx: number, argPtr: number): void;
  js_pal_deregister_interrupt(pin: number): void;
  js_pal_poll_interrupt(outCbPtr: number, outArgPtr: number): boolean;

  // --- PAL OSAL ---
  /** Asyncify yield point. MUST return Promise<void>. See Global Constraints. */
  js_pal_os_sleep_ms(ms: number): Promise<void>;
  /** Asyncify yield point. MUST return Promise<void>. */
  js_pal_os_busy_wait_us(us: number): Promise<void>;
  js_pal_os_get_ms(): bigint;
  js_pal_os_get_us(): bigint;

  // --- DAL bypass (physical-quantity injection, ADR-0003 decision 2) ---
  js_sim_trigger_ultrasonic(trigPin: number): void;
  js_sim_measure_echo_pulse_us(trigPin: number): number;
}
