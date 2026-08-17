# 4.6 Physical Degradation Engine & Fault Injection (WASM Wave 2 Backport)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/06-physical-degradation-engine.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

> **Status**: Accepted (Living Spec) · **Updated**: 2026-06-29
>
> This document backports the architecture of [ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md) ("Physical Characteristics Simulation & Fault Injection Architecture") to the WebAssembly simulation target (`targets/wasm`), while establishing the Wasm-side landing for [ADR-0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md) Decision 3 ("Virtual Clock").

---

## 0. Scope & Exclusions

**In Scope**:
- Wasm target OSAL/HAL adaptation layer (`wink-micro-os/targets/wasm/`).
- Target-neutral math library (`wink-micro-os/targets/common/src/wink_sim_physical.c`).
- Browser UniSim Worker bridge (`@wink-ai/unisim`).

**Out of Scope**:
- Real hardware targets (`esp32` / `baremetal`) — **Zero Compilation Pollution** ([ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md) §4.3).
- Electrical-level SPICE simulation (ADR-0003).
- Preemptive multi-tasking RTOS simulation.

---

## 1. Overall Architecture (Hybrid Double-Domain)

```text
 ┌─────────────────────────── UI Main Thread (Vue 3) ──────────────────────┐
 │  Canvas Interaction, 3D Viewport, Fault Sliders                          │
 └────────────────────────────────▲────────────────────────────────────────┘
                                  │ postMessage (UI ↔ Worker)
                                  ▼
 ┌────────────────────── UniSim Worker (TS) ────────────────────────────────┐
 │  VirtualClock(bigint)  ──────►  WasmPhysicalBridge  ─────► SimWorker     │
 │     │                                │                          │        │
 │     │  Sole Clock Authority          │ cwrap setters            │        │
 │     │                                ▼                          ▼        │
 │     └─────►  pal_wasm_advance_virtual_clock(us:bigint)   …      …        │
 └────────────────────────────────▲────────────────────────────────────────┘
                                  │ wasm exports / imports (bigint ABI)
                                  ▼
 ┌──────────────────── wasm Sandbox (C, Emscripten) ────────────────────────┐
 │                                                                          │
 │  ┌─ pal_osal_wasm.c ──────────────────────────────────────────────────┐  │
 │  │  s_virtual_us  ←── pal_wasm_advance_virtual_clock(us) (Single Gate)│  │
 │  │  pal_get_us / pal_get_ms (Pure read, zero JS overhead)              │  │
 │  │  pal_delay_ms/us: Asyncify suspend only, **no active stepping**    │  │
 │  └────────────────────────────────────────────────────────────────────┘  │
 │                                                                          │
 │  ┌─ pal_wasm_physical.c ─────────────────────────────────────────────┐   │
 │  │  faults POD ({0} == ideal) + PRNG state + per-pin ctx[128]        │   │
 │  │  Exported setters: pal_wasm_set_{bounce_us,warmup_us,...}          │   │
 │  │  Exported reset: pal_wasm_reset_physical()                        │   │
 │  └───────────────────────────────────────────────────────────────────┘   │
 │                                                                          │
 │  ┌─ pal_hal_wasm.c (GPIO/I2C Middleware) ────────────────────────────┐   │
 │  │  pal_gpio_read: Transparent debounce state machine overlay        │   │
 │  │  pal_i2c_transfer: Injects WINK_ERR_TIMEOUT on PRNG threshold     │   │
 │  └───────────────────────────────────────────────────────────────────┘   │
 │                                                                          │
 │  ┌─ targets/common/src/wink_sim_physical.c (Math Library SSOT) ──────┐   │
 │  │  Debounce FSM / RC Lowpass + Gaussian Noise / I2C Drop / Warmup   │   │
 │  │  Single source shared with host PoC for bit-exact golden parity   │   │
 │  └───────────────────────────────────────────────────────────────────┘   │
 └──────────────────────────────────────────────────────────────────────────┘
```

**Domain Responsibilities**:
- **JS Domain**: Ideal physical states (Button pressed, distance 32cm, temp 25°C), fault parameters, and clock stepping.
- **C/Wasm Domain**: Local execution of degradation math, debounce state machines, noise injection, and clock reading directly from linear memory.

---

## 2. Virtual Clock SSOT Architecture

| Principle | Implementation |
|---|---|
| **Single Source of Truth** | `s_virtual_us` in `targets/wasm/pal_osal_wasm.c` (uint64_t BSS variable). |
| **Single Assignment Gate** | `pal_wasm_advance_virtual_clock(uint64_t us)`, exported via `EMSCRIPTEN_KEEPALIVE`. |
| **Sole Caller** | JS Worker (`SimWorker.STEP_CLOCK`). `pal_delay_ms/us` must **never** advance clocks. |
| **Read Access** | `pal_get_us()` / `pal_get_ms()` — direct memory reads. |
| **Type Contract** | uint64_t $\leftrightarrow$ JS `bigint` under `-s WASM_BIGINT=1`. |

---

## 3. Degradation Engine (`pal_wasm_physical.c`)

### 3.1 BSS State Layout
```c
#define WASM_SIM_MAX_PINS 128

static wink_sim_faults_t        s_faults;      /* {0} == ideal direct-pass */
static uint32_t                 s_prng;        /* Global PRNG state */
static wink_sim_bounce_ctx_t    s_pin_ctx[WASM_SIM_MAX_PINS];
```

### 3.2 Exported C $\rightarrow$ JS API

| Symbol | Parameter $\rightarrow$ JS Type | Purpose |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | `uint64_t` $\leftrightarrow$ `bigint` | Single clock write Gate |
| `pal_wasm_set_bounce_us` | `uint32_t` $\leftrightarrow$ `number` | GPIO debounce duration |
| `pal_wasm_set_warmup_us` | `uint32_t` $\leftrightarrow$ `number` | Sensor warmup delay |
| `pal_wasm_set_sample_interval_us` | `uint32_t` $\leftrightarrow$ `number` | Minimum sampling interval |
| `pal_wasm_set_adc_noise_v` | `float` $\leftrightarrow$ `number` | ADC Gaussian noise amplitude |
| `pal_wasm_set_rc_tau_s` | `float` $\leftrightarrow$ `number` | RC 1st-order filter time constant |
| `pal_wasm_set_i2c_drop_permil` | `uint16_t` $\leftrightarrow$ `number` | I2C packet drop rate (permil) |
| `pal_wasm_set_prng_seed` | `uint32_t` $\leftrightarrow$ `number` | Seed for reproducible PRNG runs |
| `pal_wasm_get_prng_state` | Returns `uint32_t` | PRNG state inspection |
| `pal_wasm_reset_physical` | — | Clears faults, PRNG, and pin contexts |

---

## 4. Fault Injection Layering Discipline

| Level | Middleware Location | Fault Types | Transparent to App? |
|---|---|---|---|
| **L1 PinManager** | `pal_hal_wasm.c` | GPIO open-circuit, debounce, weak pullups | ✅ |
| **L2 Bus Controller** | `pal_hal_wasm.c::pal_i2c_transfer` | I2C NACKs, SPI bit flips, timeouts | ✅ |
| **L3 Device Driver** | `dal/*_sim.c` | Out-of-range sensor values, motor stalls | ❌ (Explicit) |

---

## 5. Cross-Language Contracts (JS $\leftrightarrow$ Wasm)

1. **BigInt ABI**: Built with `-s WASM_BIGINT=1`.
2. **Worker Protocol**: Handles `INIT`, `SET_FAULTS`, `STEP_CLOCK`, `SET_GPIO_IDEAL`, `READ_GPIO_DEGRADED`, and `TEST_I2C_TRANSFER`.

---

## 6. Verification & Zero Compilation Pollution

Static checks enforce that `wink_sim_physical` and `pal_wasm_physical` symbols never leak into `esp32` or `baremetal` target builds.
