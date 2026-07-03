/**
 * Fault domain types — audit log events + control knobs.
 *
 * Consumed by:
 *   - future Phase C UI/Worker layers that will decode the fault ring buffer
 *     exposed by pal_wasm_fault_event_get_* accessors (wasm_bridge.h lines
 *     183-186) and drive fault-injection.
 *
 * Not consumed by Phase B bridge/ code — the existing SimFaultsConfig in
 * WasmPhysicalBridge.ts continues to drive the pal_wasm_set_* setters. This
 * file is a forward declaration so Phase C can add UI without another type
 * churn.
 *
 * The C-side event ring buffer stores rows accessed by index; JS decodes
 * one FaultAuditLogEvent per index in [0, pal_wasm_get_fault_log_count()).
 */

/**
 * C-side `uint8_t` type discriminator. Values match `pal_wasm_fault_event_type_t`
 * (defined in pal_wasm_internal.h). Kept as `number` at the wire boundary; a
 * separate helper (out of Phase B scope) can widen to string-literal union.
 */
export type FaultEventTypeCode = number;

export interface FaultAuditLogEvent {
  /**
   * uint64_t virtual-clock timestamp (µs) captured when the event fired.
   * Comes from pal_wasm_fault_event_get_timestamp(index), bigint per
   * WASM_BIGINT ABI.
   */
  timestampUs: bigint;
  /** uint8_t discriminator from pal_wasm_fault_event_get_type(index). */
  type: FaultEventTypeCode;
  /** uint16_t pin number (for GPIO events) or I²C bus/addr code. */
  pinOrBus: number;
  /** uint32_t monotonic sequence (from pal_wasm_fault_event_get_sequence). */
  sequence: number;
}

/**
 * Control-surface knob set for the fault domain. Phase B mirrors exactly
 * the fields already accepted by WasmPhysicalBridge.setFaults() — see
 * SimFaultsConfig — but keeps the type here as the future SSOT so Phase C
 * UI can bind to a single interface. When Phase C adds new knobs, extend
 * this interface and the existing SimFaultsConfig-based code will fail
 * type-checking until it's updated.
 */
export interface FaultDomainControl {
  /** uint32_t debounce window in µs (pal_wasm_set_bounce_us). */
  bounceUs: number;
  /** uint32_t sensor warm-up in µs (pal_wasm_set_warmup_us). */
  warmupUs: number;
  /** uint32_t ADC sample interval µs (pal_wasm_set_sample_interval_us). */
  sampleIntervalUs: number;
  /** float additive ADC noise (V) (pal_wasm_set_adc_noise_v). */
  adcNoiseV: number;
  /** float RC time-constant (s) (pal_wasm_set_rc_tau_s). */
  rcTauS: number;
  /** uint16_t I²C drop-rate per-mille 0..1000 (pal_wasm_set_i2c_drop_permil). */
  i2cDropPermil: number;
  /** uint32_t PRNG seed for deterministic replay (pal_wasm_set_prng_seed). */
  prngSeed: number;
}
