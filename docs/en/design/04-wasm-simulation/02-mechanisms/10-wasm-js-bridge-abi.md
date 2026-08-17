# Wasm↔JS Bridge ABI Contract

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/10-wasm-js-bridge-abi.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Landed** (`wasm_bridge.h` / TypeScript `WasmImports` & `WasmExports` / `ssotAlignment` drift tests); Individual export capabilities may contain stubs (e.g., power modeling) |
| Supporting Axis | Cross-Cutting ABI |
| Associated Code | **`wink-micro-os/targets/wasm/wasm_bridge.h` (ABI SSOT)**, `wink-micro-os/targets/wasm/wink_sim_js.js`, `wink-micro-os/targets/wasm/exported_runtime_functions.json`, `@wink-ai/unisim` (WasmImports / WasmExports / ssotAlignment) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0009, 0019, 0042, 0045 |
| Migrated From | `04-wasm-simulation-2.0/10-wasm-js-bridge-abi.md` |

> This document is the human-readable mirror of `wasm_bridge.h`: centralizing cross-boundary C↔JS symbols, type mappings, and 7 implicit ABI contracts.

---

## 1. General Principles

- All host imports (`js_pal_*` / `js_sim_*`) are declared centrally in `wasm_bridge.h`.
- Type mappings under `-s WASM_BIGINT=1`:

| C Type | JS Type | Notes |
|---|---|---|
| `uint64_t` / `int64_t` | `bigint` | Timestamp fields; `number` strictly forbidden |
| `uint32_t` / `uint16_t` / `uint8_t` / `int32_t` | `number` | Safe for $\le 53$-bit integers |
| `float` / `double` | `number` | IEEE 754 float conversions |
| `bool` | `boolean` | Boolean flag |
| Pointer (wasm32) | `number` | 4-byte byte offset in Wasm heap |

---

## 2. 7 Implicit ABI Contracts

### ABI #1: Downward Stack Growth
Wasm stack grows downward. Asyncify unwind/rewind relies on this behavior. Protected via `-s ASYNCIFY_STACK_SIZE=65536`.

### ABI #2: Floating-Point & NaN Boxing
- `long double` is prohibited;
- JS host must validate `isFinite()` before passing floats into C to avoid unexpected NaN propagation.

### ABI #3: Pointer Alignment
- Wasm `malloc` guarantees 8-byte alignment;
- `uint64_t` and `double` accesses must be 8-byte aligned.

### ABI #4: `EM_JS` Static Inlining
`EM_JS` macros embed JavaScript at compile-time and cannot access runtime closures.

### ABI #5: WASM_BIGINT ABI
- Bridges `uint64_t` $\leftrightarrow$ JS `bigint`;
- Passing `number` to BigInt bindings throws a runtime `TypeError`.

### ABI #6: Asyncify Reentrancy Restrictions (+ `safeWrap` Guards)
While Wasm is sleeping (Asyncify yielded):
- Host **must never** invoke state-mutating `pal_wasm_*` exports;
- Host **must never** read/write the Wasm linear heap (`HEAPU8`);
- Framework-owned state changes (`PinArbiter`, `InterruptQueue`) are enqueued and drained on subsequent Wasm entry.

**Import + Export Guardrails**:
1. **Import Layer (C $\rightarrow$ JS)**: `safeWrap`/`safeWrapAsync` traps exceptions and returns resolved Promises, marshaling errors to `pal_wasm_host_fault(8003, msg)`.
2. **Export Layer (JS $\rightarrow$ C)**: Proxy wrappers (`createSafeExportsProxy`) intercept calls during yielded states and throw typed `ABI Guard` errors.
3. Fault latches short-circuit state-mutating exports via `WASM_FAULT_GUARD_*`.

### ABI #7: Binding Manifest & Fail-Loud Validation
- Host mounts provide explicit `requiredExports` manifests;
- Missing export symbols fail immediately with `throw Error`;
- Validates ABI hash handshakes via `pal_wasm_get_abi_hash()`.

---

## 3. JS $\rightarrow$ C Imports (`js_*`)

### 3.1 PAL HAL (GPIO / PWM / Buses)

| Symbol | Signature | Description |
|---|---|---|
| `js_pal_gpio_write` | `(uint16_t pin, bool level)` | Writes pin output to PinArbiter |
| `js_pal_gpio_read_state` | `(uint16_t pin) → uint8_t` | Electrical SSOT read (0=LOW, 1=HIGH, 2=HiZ, 3=CONFLICT) |
| `js_pal_gpio_drive_ideal` | `(uint16_t pin, bool level)` | Injects ideal level from UI |
| `js_pal_gpio_release_ideal` | `(uint16_t pin)` | Removes ideal driver |
| `js_pal_gpio_release_mcu` | `(uint16_t pin)` | Releases MCU driver |
| `js_pal_pwm_set_duty` | `(uint8_t channel, float duty_percent)` | Sets Channel 1b PWM duty (0–100%) |
| `js_pal_adc_read_norm` | `(uint16_t pin) → float` | Reads normalized $[0, 1]$ analog voltage |
| `js_pal_i2c_transfer` | `(uint8_t port, uint16_t addr, ...)` | Synchronous I2C heap transfer |
| `js_pal_spi_transfer` | `(uint8_t port, uint16_t dev_id, ...)` | Full-duplex SPI transfer |
| `js_pal_uart_write` | `(uint8_t port, const uint8_t* buf, uint32_t len)` | Transmits UART byte stream |

### 3.2 Interrupt Polling

| Symbol | Signature | Description |
|---|---|---|
| `js_pal_register_interrupt` | `(uint16_t pin, uint32_t callback_index, uint32_t arg_ptr)` | Registers ISR mapping in JS |
| `js_pal_deregister_interrupt` | `(uint16_t pin)` | Unregisters mapping |
| `js_pal_poll_interrupt` | `(uint32_t* out_callback_index, uint32_t* out_arg_ptr) → bool` | Pulls pending interrupt from FIFO |

### 3.3 PAL OSAL

| Symbol | Signature | Asyncify | Description |
|---|---|---|---|
| `js_pal_os_sleep_ms` | `(uint32_t ms)` | **Yes (`'auto'`)** | Must return `Promise<void>` |
| `js_pal_os_busy_wait_us` | `(uint32_t us)` | **Yes (`'auto'`)** | Must return `Promise<void>` |

---

## 4. C $\rightarrow$ JS Exports (`pal_wasm_*` / `pal_os_*`)

### 4.1 Physical Degradation Engine

| Symbol | Signature | Description |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | `(uint64_t us)` | Steps virtual clock Single Gate |
| `pal_wasm_set_bounce_us` | `(uint32_t)` | Sets debounce duration |
| `pal_wasm_set_warmup_us` | `(uint32_t)` | Sets warmup delay |
| `pal_wasm_set_sample_interval_us` | `(uint32_t)` | Sets minimum sampling interval |
| `pal_wasm_set_adc_noise_v` | `(float)` | Sets ADC noise amplitude |
| `pal_wasm_set_rc_tau_s` | `(float)` | Sets RC filter time constant |
| `pal_wasm_set_i2c_drop_permil` | `(uint16_t)` | Sets I2C packet drop rate |
| `pal_wasm_set_prng_seed` | `(uint32_t)` | Sets PRNG seed |
| `pal_wasm_get_prng_state` / `set_prng_state` | `() → uint32_t` / `(uint32_t)` | PRNG state capture and restore |
| `pal_wasm_get_abi_hash` | `() → uint32_t` | Returns ABI hash lock |
| `pal_wasm_reset_physical` | `()` | Resets physical simulation state |

### 4.2 Timers & Observability

| Symbol | Signature | Description |
|---|---|---|
| `pal_wasm_is_clock_warning_fired` | `() → bool` | Checks uint64 overflow warning |
| `pal_wasm_get_virtual_clock_us` | `() → uint64_t` | Reads virtual clock |
| `pal_os_get_us` / `pal_os_get_ms` | `() → uint64_t` | Direct memory clock exports |
| `pal_wasm_gpio_read` | `(uint16_t pin) → bool` | Boolean wrapper |
| `pal_wasm_i2c_transfer` | `(...) → bool` | Boolean I2C wrapper |

### 4.3 Fault Audit & Fault Injection

| Symbol | Description |
|---|---|
| `pal_wasm_get_fault_log_count` / `reset_fault_log` | Circular fault log inspection |
| `pal_wasm_get_fault_log_raw_ptr` | Direct pointer to fault log memory |
| `pal_wasm_fault_event_get_*` | Per-field fault log accessors |
| `pal_wasm_is_faulted` | Fault latch inspection |
| `pal_wasm_host_fault(uint32_t code, const char* msg_cstr)` | Host exception injector (Code 8003) |
| `pal_wasm_set_pin_power_model` / `get_total_energy_mj` | Power modeling stubs (Wave 3) |

### 4.4 Peripheral Control & Execution Modes

| Symbol | Description |
|---|---|
| `pal_wasm_sim_reset_all_devices` | Resets all virtual devices |
| `pal_wasm_get_servo_angle` / `pal_wasm_get_pwm_duty_percent` | Actuator angle & PWM observation |
| `pal_wasm_push_pin_event` | Injects scheduled pin edge into event queue |
| `pal_wasm_set_gpio_input` / `pal_wasm_get_gpio_output` | GPIO injection & observation |
| `pal_wasm_set_sim_mode` / `pal_wasm_get_sim_mode` | Switches INTERACTIVE vs HEADLESS mode |

---

## 5. Runtime Export Configuration (`exported_runtime_functions.json`)

```json
{
  "EXPORTED_FUNCTIONS": ["_main", "_malloc", "_free"],
  "EXPORTED_RUNTIME_METHODS": ["ccall", "cwrap", "HEAPU8", "Asyncify", "callMain"],
  "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"],
  "ASYNCIFY_STACK_SIZE": 65536,
  "EXPORT_NAME": "WasmSandbox"
}
```

---

## 6. Field-Level Accessor Rules

Cross-boundary data structures are accessed via granular field getters rather than copying compound structs, preventing memory layout drifts.

---

## 7. Anti-Drift Tooling

- C: `wasm_bridge.h` is the sole extern source of truth;
- TypeScript: `types/wasm/imports.ts` defines `WasmImports` mirrors;
- CI: `ssotAlignment.test.ts` asserts identical symbol keys across languages.

---

## 8. Wasm64 Migration Gate

`_Static_assert(sizeof(void*) == 4)` validates wasm32 assumptions. Moving to wasm64 requires expanding out-pointers to BigInt and updating `writeU32LE` helpers to 64-bit.

---

## 9. API × Axis × Phase Cross-Reference

| Symbol | Axis | Channel / Sub-system | Direction | Phase / Status |
|---|---|---|---|---|
| `js_pal_gpio_write` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_read_state` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_drive_ideal` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_release_ideal` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_release_mcu` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_on_write` | A | CH1 Pin | C→JS | Landed |
| `pal_wasm_push_pin_event` | A+B | CH1 + VirtualClock | JS→C | Landed |
| `pal_wasm_set_gpio_input` | A | CH1 Pin | JS→C | Landed |
| `pal_wasm_get_gpio_output` | A | CH1 Pin | JS→C | Landed |
| `pal_wasm_gpio_read` | A | CH1 Pin | JS→C | Landed |
| `js_pal_pwm_set_duty` | A+C | CH1b PWM | C→JS | Landed |
| `pal_wasm_get_pwm_duty_percent` | C | CH1b PWM | JS→C | Landed |
| `js_pal_i2c_transfer` | A | CH2 I2C | C→JS | Landed |
| `js_pal_spi_transfer` | A | CH2 SPI | C→JS | Phase 4 stub |
| `js_pal_uart_write` | A | CH2 UART TX | C→JS | Landed |
| `pal_wasm_i2c_transfer` | A | CH2 I2C | JS→C | Landed |
| `pal_wasm_set_i2c_drop_permil` | A+F | CH2 I2C Degradation | JS→C | Landed |
| `pal_wasm_push_uart_rx_byte` | A+E | CH2 UART RX | JS→C | Landed |
| `pal_wasm_push_uart_rx_error` | A+F | CH2 UART Error | JS→C | Landed |
| `js_pal_adc_read_norm` | A | CH3 Analog | C→JS | Landed |
| `pal_wasm_set_adc_noise_v` | A+F | CH3 Degradation | JS→C | Landed |
| `pal_wasm_set_rc_tau_s` | A+F | CH3 RC Filter | JS→C | Landed |
| `js_pal_ws2812_write` | A | CH4 WS2812 | C→JS | Landed |
| `js_sim_get_plugin_channel` | A | Plugin Observation | C→JS | Landed |
| `js_pal_os_sleep_ms` | B | OSAL Delay | C→JS | Landed (Asyncify) |
| `js_pal_os_busy_wait_us` | B | OSAL Busy-Wait | C→JS | Landed (Asyncify) |
| `pal_wasm_advance_virtual_clock` | B | VirtualClock | JS→C | Landed |
| `pal_wasm_is_clock_warning_fired` | B | VirtualClock | JS→C | Landed |
| `pal_wasm_get_virtual_clock_us` | B | VirtualClock | JS→C | Landed |
| `pal_os_get_us` / `pal_os_get_ms` | B | OSAL Clock | JS→C | Landed |
| `js_pal_register_interrupt` | D | IRQ Poll | C→JS | Landed |
| `js_pal_deregister_interrupt` | D | IRQ Poll | C→JS | Landed |
| `js_pal_poll_interrupt` | D | IRQ Poll | C→JS | Landed |
| `pal_wasm_get_fault_log_count` | F | Fault Log | JS→C | Landed |
| `pal_wasm_reset_fault_log` | F | Fault Log | JS→C | Landed |
| `pal_wasm_get_fault_log_raw_ptr` | F | Fault Log Buffer | JS→C | Landed |
| `pal_wasm_fault_event_get_timestamp` | F | Fault Log Accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_type` | F | Fault Log Accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_pin_or_bus` | F | Fault Log Accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_sequence` | F | Fault Log Accessor | JS→C | Landed |
| `pal_wasm_is_faulted` | F | Fault State | JS→C | Landed |
| `pal_wasm_host_fault` | F | Fault Injection | JS→C | Landed |
| `pal_wasm_get_abi_hash` | F | ABI Hash Lock | JS→C | Landed |
| `pal_wasm_set_pin_power_model` | F | Power Model | JS→C | Wave 3 stub |
| `pal_wasm_get_total_energy_mj` | F | Power Model | JS→C | Wave 3 stub |
| `pal_wasm_set_bounce_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_warmup_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_sample_interval_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_prng_seed` | A+F | PRNG Seed | JS→C | Landed |
| `pal_wasm_get_prng_state` / `set_prng_state` | A+F | PRNG State | JS→C | Landed |
| `pal_wasm_reset_physical` | A+F | Degradation Reset | JS→C | Landed |
| `pal_wasm_set_fidelity_level` | A+F | Fidelity Level | JS→C | Landed |
| `pal_wasm_sim_reset_all_devices` | A+F | Device Control | JS→C | Landed |
| `pal_wasm_set_sim_mode` / `get_sim_mode` | F | Execution Mode | JS→C | Landed |
| `js_pal_log` | — | Logging | C→JS | Landed |
