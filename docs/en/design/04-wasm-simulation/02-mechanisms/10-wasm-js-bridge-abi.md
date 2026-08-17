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
| **Landed** | **Landed** (`wasm_bridge.h` / TS `WasmImports` · `WasmExports` / `ssotAlignment` anti-drift); Individual export capabilities themselves may be Stubs (such as power models, see notes in symbol tables) |
| Supporting Axis | Cross-Cutting ABI (Not attached to A~F primary) |
| Associated Code | **`wink-micro-os/targets/wasm/wasm_bridge.h` (ABI SSOT)**, `wink-micro-os/targets/wasm/wink_sim_js.js`, `wink-micro-os/targets/wasm/exported_runtime_functions.json`, `@wink-ai/unisim` (WasmImports / WasmExports / ssotAlignment) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0009, 0019, 0042, 0045 |
| Migrated From | `04-wasm-simulation-2.0/10-wasm-js-bridge-abi.md` |

> This document is the human-readable mirror of `wasm_bridge.h`: centralizing all C↔JS cross-boundary symbols, type contracts, and 7 implicit ABI prerequisites. **Symbol signatures take the header file as authoritative**; if this document conflicts with the header, follow the header and synchronize this document upon changes. TypeScript `WasmImports`/`WasmExports` and `ssotAlignment.test.ts` (parsing headers to compare keys) prevent drift at compile and test time. Modifications to bridge code must not violate the contracts below.
>
> **Cross-Reference**: Asyncify yield / Execution Mode $\rightarrow$ [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md); Fault / safeWrap paths $\rightarrow$ [`05-memory-and-faults.md`](./05-memory-and-faults.md); this document defines the **contracts** (ABI #6).

---

## 1. General Principles

- All `extern` declarations for Wasm simulation imports from JS (`js_pal_*` / `js_sim_*`) are centralized in `wink-micro-os/targets/wasm/wasm_bridge.h`, eliminating drift across multiple `.c` files;
- Convention: `js_sim_*` (DAL/device bypass) contracts take the Device Registry as SSOT, and this header copies from the Registry;
- Type mapping (`-s WASM_BIGINT=1`):

| C Type | JS Type | Description |
|---|---|---|
| `uint64_t`/`int64_t` | `bigint` | Clock fields; `number` strictly forbidden (loss of precision) |
| `uint32_t`/`uint16_t`/`uint8_t`/`int32_t` | `number` | Safe for $\le 53$-bit integers |
| `float`/`double` | `number` | IEEE 754 float conversion |
| `bool` | `boolean` | |
| Pointer (wasm32) | `number` | Wasm heap byte offset, 4 bytes; wasm64 migration see §8 |

- Exported symbols are annotated with `EMSCRIPTEN_KEEPALIVE` (`pal_wasm_*`/`pal_os_*`); visibility originates from KEEPALIVE, and headers only provide cross-translation-unit declarations.

> **Header Note (2026-08-02)**: The top of `wasm_bridge.h` still contains historical comments stating "Plan 4 will append `js_sim_trigger_ultrasonic` / `js_sim_measure_echo_pulse_us`"—these symbols **do not exist**, and the deprecation notes in the channel document govern ([`08-channel-routing.md`](./08-channel-routing.md) §5); do not add new imports based on that comment.

---

## 2. Seven Implicit ABI Contracts (Mandatory for Bridge Modifiers)

### ABI #1: Wasm Stack Grows Downward
Emscripten Wasm stack grows from high memory addresses toward low addresses; Asyncify unwind/rewind relies on this behavior. Cannot be enforced via `_Static_assert` (runtime property). Risk: Stack overflow silently overwrites heap. Protection: `-s ASYNCIFY_STACK_SIZE=65536` provides headroom.

### ABI #2: Floating-Point and NaN Boxing
- C `float`/`double` $\leftrightarrow$ JS `number`: IEEE 754 safe conversion;
- **Prohibited: `long double`** (Emscripten degrades to double);
- JS `NaN`/`Infinity` passed to C are valid IEEE values, but C logic may not handle them $\rightarrow$ JS side must perform `isFinite` checks before passing into C (combined with `sanitizeFloat` sanitization logic to prevent pollution).

### ABI #3: Pointer Alignment
- Emscripten `malloc` guarantees 8-byte alignment;
- `uint64_t`/`double` accesses require 8-byte alignment; unaligned access in Wasm is UB (may silently read corrupted values);
- Cross-boundary structs use `__attribute__((aligned(8)))` or packed + `memcpy`.

### ABI #4: `EM_JS` Macro Expansion Timing
JS defined via `EM_JS` is embedded into binaries at **compile time**: immutable at runtime, cannot access JS closures (global scope only), and parameter passing incurs overhead; avoid hot-path invocations.

### ABI #5: WASM_BIGINT ABI
- Enabling `-s WASM_BIGINT=1` enables exact bridging between `uint64_t`/`int64_t` $\leftrightarrow$ JS `bigint`;
- Accidental use of `number` in TS throws a runtime `TypeError` (runtime safeguard backing TS compile-time checks);
- All clock/time fields in TS are strictly `bigint`; perform runtime `typeof` validation after deserialization. See details in [`02-virtual-clock.md`](./02-virtual-clock.md).

### ABI #6: Asyncify Reentrancy Restrictions (+ safeWrap Fallback)
While in Asyncify sleeping state (Wasm has unwound, awaiting Promise-returning import resolution):
- Host **must not** invoke any `pal_wasm_*` exports (linear memory/stack portions reside in Asyncify backup buffers; reentrancy reads inconsistent state and risks corrupting the backup stack);
- Host **must not** directly read/write the Wasm heap (`HEAPU8` views may point to stale content due to temporary Asyncify relocation, becoming consistent only after rewind);
- Pure JS-side logic is **permitted** (VirtualClock stepping, `PinArbiter.setDriver`, `InterruptQueue.push` and other framework-owned components)—modifying JS state only, redeemed on next Wasm entry via Phase 0/`js_pal_poll_interrupt`/`js_pal_gpio_read` pull paths.

**P0-3/P1-4 Dual-Layer Defense (Import + Export Safety Net)**:
1. **Import Layer (C $\rightarrow$ JS)**: `safeWrap`/`safeWrapAsync` HOFs apply try/catch + `Promise.catch` to all user-overridable `js_*` imports; host exceptions/rejections always return resolved Promises $\rightarrow$ Emscripten never encounters throw/reject and never aborts; errors marshal to `pal_wasm_host_fault(8003, msg)` following the standard fault path (Fault semantics see [`05-memory-and-faults.md`](./05-memory-and-faults.md));
2. **Export Layer (JS $\rightarrow$ C)**: TS side uses `createSafeExportsProxy` to guard `WasmExports`. Under Asyncify Sleeping / BusyWait suspended states (`isYielded`), intercepts Host-initiated writes and state-mutating `pal_wasm_*` export invocations, throwing strongly typed `ABI Guard` exceptions to prevent reentrant corruption of the Wasm heap and backup stack;
3. Once `pal_wasm_host_fault` sets the `s_wasm_faulted` latch, all state-mutating `pal_wasm_*` exports fast-fail to no-ops via `WASM_FAULT_GUARD_*` macros; `pal_wasm_is_faulted()` remains readable.

### ABI #7: Binding Manifest and Fail-Loud Explicit Existence Validation
- When TS host and peripherals mount Wasm Exports, they must provide an explicit binding table (**Binding Manifest**, e.g. `requiredExports: ['pal_wasm_push_pin_event', ...]`);
- **Prohibited: Relying on silent `undefined` from weak Proxy dynamic lookups**: If a required export is missing or misspelled on the underlying Emscripten Module, mounting must immediately Fail-Loud with `throw Error`;
- Mounting enforces an ABI Hash handshake check (`pal_wasm_get_abi_hash()`), guarding against firmware and frontend dependency mismatches.

Asyncify suspension and Execution Mode behaviors are documented in [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md).

---

## 3. JS $\rightarrow$ C Imports (`js_*`, C extern Declarations)

### 3.1 PAL HAL (GPIO/PWM/Buses)

| Symbol | Signature | Description |
|---|---|---|
| `js_pal_gpio_write` | `(uint16_t pin, bool level)` | GPIO output to PinArbiter |
| ~~`js_pal_gpio_read`~~ | ~~`(uint16_t pin) → bool`~~ | **Completely removed**: Upgraded to `js_pal_gpio_read_state` |
| `js_pal_gpio_read_state` | `(uint16_t pin) → uint8_t` | **Electrical SSOT Read**: 0=LOW/1=HIGH/2=HiZ/3=CONFLICT (see [`07-peripheral-registry.md`](./07-peripheral-registry.md) §4.2) |
| `js_pal_gpio_drive_ideal` | `(uint16_t pin, bool level)` | UI/test ideal injection, driver id `ideal:ui:{pin}` SUPPLY |
| `js_pal_gpio_release_ideal` | `(uint16_t pin)` | Removes ideal driver only |
| `js_pal_gpio_release_mcu` | `(uint16_t pin)` | Removes `mcu:gpio{N}` (INPUT*/open-drain release) |
| `js_pal_pwm_set_duty` | `(uint8_t channel, float duty_cycle_percent)` | Channel 1b, duty is 0~100 percentage |
| `js_pal_adc_read_norm` | `(uint16_t pin) → float` | Channel 3: Reads normalized value `[0,1]` from `PinArbiter.readAnalog(pin)`. **Does not return mV**—raw/mV conversion happens in C `pal_wasm_adc.c` (ADR-0057); full scale is held by PAL per-channel state, opaque to JS |
| `js_pal_i2c_transfer` | `(uint8_t port, uint16_t dev_addr, const uint8_t* wbuf, uint32_t wlen, uint8_t* rbuf, uint32_t rlen) → bool` | Synchronous Heap slice in same Worker |
| `js_pal_spi_transfer` | `(uint8_t port, uint16_t device_id, const uint8_t* tx, uint32_t len, uint8_t* rx, uint8_t mode, uint32_t sck_hz) → bool` | Full-duplex; device_id is chip-select/device index; mode 0..3; Phase 4 T5 minimal stub |
| `js_pal_uart_write` | `(uint8_t port, const uint8_t* buf, uint32_t len)` | Writes UART frame (TX). **No** symmetrical `js_pal_uart_read`; async RX **Planned** (see [`08`](./08-channel-routing.md)) |
| `js_pal_gpio_on_write` | `(uint8_t pin, uint8_t level)` | GPIO write notification bridge |

### 3.2 Interrupt Polling (Option C)

| Symbol | Signature | Description |
|---|---|---|
| `js_pal_register_interrupt` | `(uint16_t pin, uint32_t callback_index, uint32_t arg_ptr)` | C informs pin $\rightarrow$ (cb, arg) mapping on ISR registration; JS stores without invoking callback |
| `js_pal_deregister_interrupt` | `(uint16_t pin)` | Unregisters mapping |
| `js_pal_poll_interrupt` | `(uint32_t* out_callback_index, uint32_t* out_arg_ptr) → bool` | C actively pulls one pending interrupt per tick; FIFO, repeated calls until false |

> Legacy push model `_trigger_wasm_interrupt` has been permanently removed. Details in [`04-interrupt-model.md`](./04-interrupt-model.md). `callback_index` is an opaque Wasm Table index; wasm32 truncates with `(uint32_t)(uintptr_t)`, and wasm64 must migrate.

### 3.3 PAL OSAL

| Symbol | Signature | Asyncify | Description |
|---|---|---|---|
| `js_pal_os_sleep_ms` | `(uint32_t ms)` | **Yes (`'auto'`)** | Must return `Promise<void>` |
| `js_pal_os_busy_wait_us` | `(uint32_t us)` | **Yes (`'auto'`)** | Must return `Promise<void>` |

- Time SSOT: C `pal_os_get_us/ms()` reads `s_virtual_us` directly (zero JS calls), advanced via C $\rightarrow$ JS export `pal_wasm_advance_virtual_clock`; **no** JS $\rightarrow$ C `get_ms/get_us` imports exist (legacy dead `js_pal_os_get_ms/us` stubs deleted).
- These two are currently the only ASYNCIFY_IMPORTS (see `exported_runtime_functions.json`).

### 3.4 Logging and Plugin Channel

| Symbol | Signature | Description |
|---|---|---|
| `js_pal_log` | `(uint8_t level, const char* msg)` | level=ERROR1/WARN2/INFO3/DEBUG4; msg is NUL-terminated UTF-8 (Wasm heap offset), synchronous invocation where JS must not retain pointers |
| `js_sim_get_plugin_channel` | `(const char* instance_id, const char* channel_name) → float` | Plugin physical semantic read (such as `"ultrasonic:0"` / `"distanceCm"`). **Observation / Plugin SSOT**; **prohibited** as DAL business bypass. C-side cm $\rightarrow$ µs measurement shortcut is **Deprecated** (see [`08-channel-routing.md`](./08-channel-routing.md) §4) |

---

## 4. C $\rightarrow$ JS Exports (`pal_wasm_*` / `pal_os_*`, KEEPALIVE)

### 4.1 Physical Degradation Engine (ADR-0009 Wave 2)

| Symbol | Signature | Description |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | `(uint64_t us)` | Clock advance (INTERACTIVE path, via Single Gate) |
| `pal_wasm_set_bounce_us` | `(uint32_t)` | Debounce |
| `pal_wasm_set_warmup_us` | `(uint32_t)` | Warmup |
| `pal_wasm_set_sample_interval_us` | `(uint32_t)` | Sampling interval |
| `pal_wasm_set_adc_noise_v` | `(float)` | ADC noise |
| `pal_wasm_set_rc_tau_s` | `(float)` | RC tau |
| `pal_wasm_set_i2c_drop_permil` | `(uint16_t)` | I2C packet drop rate in per-mille |
| `pal_wasm_set_prng_seed` | `(uint32_t)` | Seed |
| `pal_wasm_get_prng_state` / `set_prng_state` | `() → uint32_t` / `(uint32_t)` | Regression / session replay (dual-repo sync) |
| `pal_wasm_get_abi_hash` | `() → uint32_t` | ABI layout lock (Bump on SimFaults/snapshot changes) |
| `pal_wasm_reset_physical` | `()` | Resets all physical state (sole executable mutator in faulted state) |

### 4.2 Clocks and Observability

| Symbol | Signature | Description |
|---|---|---|
| `pal_wasm_is_clock_warning_fired` | `() → bool` | Warning on passing UINT64 midpoint |
| `pal_wasm_get_virtual_clock_us` | `() → uint64_t` | Current virtual clock (shared with `pal_os_get_us`, convenient for cwrap) |
| `pal_os_get_us` / `pal_os_get_ms` | `() → uint64_t` | OSAL direct clock memory read export |
| `pal_wasm_gpio_read` | `(uint16_t pin) → bool` | JS-friendly boolean wrapper |
| `pal_wasm_i2c_transfer` | `(...) → bool` | Boolean return avoiding out-pointer marshaling |

### 4.3 Fault Audit and Fault Injection (Details in [`05-memory-and-faults.md`](./05-memory-and-faults.md))

| Symbol | Description |
|---|---|
| `pal_wasm_get_fault_log_count` / `reset_fault_log` | Fault circular buffer count / reset |
| `pal_wasm_get_fault_log_raw_ptr` | Bulk log array base address (16-byte stride, DataView $O(1)$ batch extraction) |
| `pal_wasm_fault_event_get_timestamp/type/pin_or_bus/sequence` | Field accessors (timestamp uses BigInt; returns 0 on out-of-bounds, check count first) |
| `pal_wasm_is_faulted` | Fault latch query |
| `pal_wasm_host_fault(uint32_t code, const char* msg_cstr)` | Host $\rightarrow$ C fault (code=8003); msg written via `_malloc`+stringToUTF8 then `_free`, nullable |
| `pal_wasm_set_pin_power_model` / `get_total_energy_mj` | Power model **Wave 3 stub** (set validates without storing, get returns 0, bigint mJ) |

### 4.4 Peripheral Control/State and Execution Modes

| Symbol | Description |
|---|---|
| `pal_wasm_sim_reset_all_devices` | Resets all virtual devices |
| `pal_wasm_get_servo_angle(uint8_t channel) → float` | Servo angle observation |
| `pal_wasm_get_pwm_duty_percent(uint8_t channel) → float` | PWM duty observation |
| `pal_wasm_push_pin_event(uint8_t pin, uint64_t delay_us, uint8_t level)` | Pin Event Queue injection (Zero-yield pulse width loopback) |
| `pal_wasm_set_gpio_input(uint8_t pin, bool level)` | GPIO input injection |
| `pal_wasm_get_gpio_output(uint8_t pin) → bool` | GPIO output observation |
| `pal_wasm_set_sim_mode(uint32_t mode)` / `get_sim_mode()` | INTERACTIVE/HEADLESS (ADR-0042) |

> Retired: `pal_wasm_get_ssd1306_fb` (Phase E)—OLED framebuffer SSOT migrated to UniSim plugin `displays[]`.

---

## 5. Runtime Export Configuration (exported_runtime_functions.json)

```json
{
  "EXPORTED_FUNCTIONS": ["_main", "_malloc", "_free"],
  "EXPORTED_RUNTIME_METHODS": ["ccall", "cwrap", "HEAPU8", "Asyncify", "callMain"],
  "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"],
  "ASYNCIFY_STACK_SIZE": 65536,
  "EXPORT_NAME": "WasmSandbox"
}
```

Startup must use `Module.callMain()` (not `_main()`), and must not `await callMain()` (main is a never-returning scheduling loop). Details in [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md).

---

## 6. Field-Level Accessor Conventions

Cross-language structs like fault events are **not** passed as monolithic buffers (avoiding alignment/padding hazards): JS first calls `get_count`, then invokes per-field getters for each index (timestamp uses BigInt, others number). Out-of-bounds getters return 0 without writing out-parameters; callers must perform boundary checks using count first.

Power model `wasm_pin_power_model_t` is a POD struct of only 3 uint32 fields; JS mallocs on Wasm heap, writes fields, and passes the pointer offset, keeping the complete definition opaque to JS (headers contain only forward `struct` declarations).

---

## 7. Anti-Drift Mechanism

- **C Side**: `wasm_bridge.h` is the single extern declaration source of truth;
- **TS Side**: `types/wasm/imports.ts` `WasmImports` interface mirrors field by field, with comments indicating the header file SSOT; `createUnisimImports` must produce `WasmImports`, and `installUnisimBridge` must assign every field;
- **Testing**: UniSim SSOT anti-drift test suite (`@wink-ai/unisim`) parses header files and validates key sets, failing upon any drift;
- **ABI Hash**: `pal_wasm_get_abi_hash()` locks SimFaults/snapshot ABI; bumping `PAL_WASM_ABI_HASH` simultaneously across C and TS on adding/modifying imports.

---

## 8. wasm64 Migration Gate

Current wasm32: Pointers are 4 bytes, with `_Static_assert(sizeof(void*)==4)` in `pal_irq_wasm.c`. Migrating to wasm64 requires:
1. Updating ABI #5 for 64-bit pointer ABI;
2. JS-side `writeU32LE → writeU64LE`, converting to BigInt;
3. Removing all `(uint32_t)(uintptr_t)` truncations in favor of full width;
4. Updating `WasmImports` out-pointer argument types to BigInt.

---

## 9. API × Axis × Phase Cross-Reference

> **Reading guide**: This table indexes every symbol in `wasm_bridge.h` by
> simulation-fidelity axis (A~F), channel, call direction, and delivery phase.
> Parameter details live in `wasm_bridge.h` — **do NOT duplicate them here**.
> Update this table whenever a symbol is added, removed, or reassigned.

| Symbol | Axis | Channel / Sub-system | Direction | Phase / Status |
|---|---|---|---|---|
| **— Axis A · CH1: Digital Pin —** |||||
| `js_pal_gpio_write` | A | CH1 Pin | C→JS | Landed |
| ~~`js_pal_gpio_read`~~ | A | CH1 Pin | C→JS | **Removed** (upgraded to `read_state`) |
| `js_pal_gpio_read_state` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_drive_ideal` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_release_ideal` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_release_mcu` | A | CH1 Pin | C→JS | Landed |
| `js_pal_gpio_on_write` | A | CH1 Pin | C→JS | Landed (observation hook) |
| `pal_wasm_push_pin_event` | A+B | CH1 + VirtualClock | JS→C | Landed |
| `pal_wasm_set_gpio_input` | A | CH1 Pin | JS→C | Landed |
| `pal_wasm_get_gpio_output` | A | CH1 Pin | JS→C | Landed |
| `pal_wasm_gpio_read` | A | CH1 Pin | JS→C | Landed (bool wrapper) |
| **— Axis A · CH1b: PWM —** |||||
| `js_pal_pwm_set_duty` | A+C | CH1b PWM | C→JS | Landed |
| `pal_wasm_get_pwm_duty_percent` | C | CH1b PWM | JS→C | Landed |
| **— Axis A · CH2: Bus —** |||||
| `js_pal_i2c_transfer` | A | CH2 I2C | C→JS | Landed |
| `js_pal_spi_transfer` | A | CH2 SPI | C→JS | Phase 4 stub |
| `js_pal_uart_write` | A | CH2 UART TX | C→JS | Landed |
| `pal_wasm_i2c_transfer` | A | CH2 I2C | JS→C | Landed (bool wrapper) |
| `pal_wasm_set_i2c_drop_permil` | A+F | CH2 I2C degradation | JS→C | Landed |
| `pal_wasm_push_uart_rx_byte` | A+E | CH2 UART RX | JS→C | Landed (Async RX) |
| `pal_wasm_push_uart_rx_error` | A+F | CH2 UART error | JS→C | Landed |
| **— Axis A · CH3: Analog ADC —** |||||
| `js_pal_adc_read_norm` | A | CH3 Analog | C→JS | Landed |
| `pal_wasm_set_adc_noise_v` | A+F | CH3 degradation | JS→C | Landed |
| `pal_wasm_set_rc_tau_s` | A+F | CH3 RC filter | JS→C | Landed |
| **— Axis A · CH4: Buffer Payload —** |||||
| `js_pal_ws2812_write` | A | CH4 WS2812 | C→JS | Landed |
| **— Axis A · Plugin Channel —** |||||
| `js_sim_get_plugin_channel` | A | Plugin observation | C→JS | Landed |
| **— Axis B: Time Base —** |||||
| `js_pal_os_sleep_ms` | B | OSAL delay | C→JS | Landed (Asyncify import) |
| `js_pal_os_busy_wait_us` | B | OSAL busy-wait | C→JS | Landed (Asyncify import) |
| `pal_wasm_advance_virtual_clock` | B | VirtualClock | JS→C | Landed |
| `pal_wasm_is_clock_warning_fired` | B | VirtualClock | JS→C | Landed |
| `pal_wasm_get_virtual_clock_us` | B | VirtualClock | JS→C | Landed |
| `pal_os_get_us` | B | OSAL clock | JS→C | Landed |
| `pal_os_get_ms` | B | OSAL clock | JS→C | Landed |
| **— Axis D: Interrupt Model —** |||||
| `js_pal_register_interrupt` | D | IRQ poll | C→JS | Landed |
| `js_pal_deregister_interrupt` | D | IRQ poll | C→JS | Landed |
| `js_pal_poll_interrupt` | D | IRQ poll | C→JS | Landed |
| **— Axis E: Scheduler / Concurrency —** |||||
| *(no dedicated extern symbols)* | E | Calling-convention contract | — | ADR-0054 + Phase 2 Task 2.0 |
| **— Axis F: Fault & Observation —** |||||
| `pal_wasm_get_fault_log_count` | F | Fault log | JS→C | Landed |
| `pal_wasm_reset_fault_log` | F | Fault log | JS→C | Landed |
| `pal_wasm_get_fault_log_raw_ptr` | F | Bulk fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_timestamp` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_type` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_pin_or_bus` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_fault_event_get_sequence` | F | Fault log accessor | JS→C | Landed |
| `pal_wasm_is_faulted` | F | Fault state | JS→C | Landed |
| `pal_wasm_host_fault` | F | Fault injection | JS→C | Landed |
| `pal_wasm_get_abi_hash` | F | ABI hash lock | JS→C | Landed |
| `pal_wasm_set_pin_power_model` | F | Power model | JS→C | Wave 3 stub |
| `pal_wasm_get_total_energy_mj` | F | Power model | JS→C | Wave 3 stub |
| **— Axes A+F: Physical Degradation Engine —** |||||
| `pal_wasm_set_bounce_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_warmup_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_sample_interval_us` | A+F | Degradation | JS→C | Landed |
| `pal_wasm_set_prng_seed` | A+F | Degradation PRNG | JS→C | Landed |
| `pal_wasm_get_prng_state` | A+F | Degradation PRNG | JS→C | Landed |
| `pal_wasm_set_prng_state` | A+F | Degradation PRNG | JS→C | Landed |
| `pal_wasm_reset_physical` | A+F | Degradation reset | JS→C | Landed |
| `pal_wasm_set_fidelity_level` | A+F | Fidelity level | JS→C | Landed |
| **— Axes A+F: Peripheral Control & Execution Mode —** |||||
| `pal_wasm_sim_reset_all_devices` | A+F | Device control | JS→C | Landed |
| `pal_wasm_set_sim_mode` | F | Execution mode | JS→C | Landed |
| `pal_wasm_get_sim_mode` | F | Execution mode | JS→C | Landed |
| **— Cross-axis Utility —** |||||
| `js_pal_log` | — | Logging | C→JS | Landed |
| **— DEPRECATED & REMOVED —** |||||
| ~~`pal_wasm_set_ultrasonic_distance`~~ | ~~A~~ | ~~CH1 shortcut~~ | JS→C | **Removed** · Replaced by `push_pin_event` ECHO pulse |
| ~~`pal_wasm_get_ultrasonic_distance`~~ | ~~A~~ | ~~CH1 shortcut~~ | JS→C | **Removed** · Replaced by `push_pin_event` ECHO pulse |
