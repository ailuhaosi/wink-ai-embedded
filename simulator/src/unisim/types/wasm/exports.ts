/**
 * WasmExports — the wasm -> JS export boundary contract.
 *
 * SSOT: wink-micro-os/targets/wasm/wasm_bridge.h `extern pal_wasm_*` / `pal_*`
 * declarations (marked EMSCRIPTEN_KEEPALIVE in the C sources). Signature
 * drift is caught at compile time (WasmPhysicalBridge constructor argument)
 * and at test time (__tests__/ssotAlignment.test.ts).
 *
 * ABI rules (WASM_BIGINT=1):
 *   - uint64_t            <-> bigint  (forced; passing `number` throws TypeError)
 *   - uint32_t / uint16_t <-> number  (safe within 53-bit precision)
 *   - float               <-> number  (IEEE-754 double demotes automatically)
 */
export interface WasmExports {
  // --- 64-bit clock (bigint required by WASM_BIGINT ABI) ---
  pal_wasm_advance_virtual_clock: (us: bigint) => void;
  pal_os_get_us: () => bigint;
  pal_os_get_ms: () => bigint;

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
  // JS-facing simplified wrappers (bool-returning, no out-pointer).
  // C-side: see pal_wasm_gpio_read / pal_wasm_i2c_transfer in pal_wasm_physical.c.
  pal_wasm_gpio_read: (pin: number) => boolean;

  /**
   * Raw C ABI signature — pointers cross as wasm-heap offsets. Kept aligned
   * with wasm_bridge.h so ssotAlignment.test.ts passes on both name AND
   * signature. Bridge / Worker code SHOULD NOT call this directly; use the
   * high-level wrapper `pal_i2c_transfer_marshalled` below which handles
   * `_malloc` + `HEAPU8.set` + `_free` around a Uint8Array + readLen shape.
   */
  pal_wasm_i2c_transfer: (
    port: number,
    devAddr: number,
    wbufPtr: number,
    wlen: number,
    rbufPtr: number,
    rlen: number,
  ) => boolean;

  // --- Fault audit log ring buffer (Wave2 Task 8) ---
  pal_wasm_get_fault_log_count: () => number;
  pal_wasm_reset_fault_log: () => void;
  pal_wasm_fault_event_get_timestamp: (index: number) => bigint;
  pal_wasm_fault_event_get_type: (index: number) => number;
  pal_wasm_fault_event_get_pin_or_bus: (index: number) => number;
  pal_wasm_fault_event_get_sequence: (index: number) => number;

  // --- Host→C fault injection (P0-3 Phase C) ---
  /** Returns true once wasm has entered the faulted state (safe-off executed). */
  pal_wasm_is_faulted: () => boolean;
  /**
   * Inject a host-side fault (e.g. user plugin threw). JS must malloc a
   * NUL-terminated UTF-8 string onto the wasm heap, pass its pointer as msgCstr,
   * then _free after this returns. msgCstr may be 0 (no message).
   * code 8003 = JS host plugin fault (by convention).
   */
  pal_wasm_host_fault: (code: number, msgCstr: number) => void;

  // --- Power model (Wave3 stub; ADR-0009 Wave 2 Task 9) ---
  /**
   * Returns wink_status_t (int): 0 = OK, NEGATIVE = error (ADR-0001 sign
   * convention). Do NOT `if (result) { ok }` — that flips the meaning.
   * modelPtr is a wasm-heap offset into a malloc'd wasm_pin_power_model_t
   * (3x uint32) struct.
   */
  pal_wasm_set_pin_power_model: (pin: number, modelPtr: number) => number;
  pal_wasm_get_total_energy_mj: () => bigint;
}

/**
 * High-level I²C helper — not part of the wasm ABI, but shipped alongside
 * WasmExports so worker/testing code has a single stable shape. Constructed by
 * WasmPhysicalBridge in production; unit tests can produce it directly (see
 * WasmPhysicalBridge.test.ts). Keeping it a SEPARATE interface prevents the
 * SSOT test from ever seeing a name collision with the wasm-side extern.
 */
export interface PalI2cTransferMarshalled {
  (port: number, devAddr: number, writeBuf: Uint8Array, readLen: number): boolean;
}
