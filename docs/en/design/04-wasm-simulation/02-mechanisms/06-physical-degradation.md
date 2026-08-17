# Physical Degradation Engine & Fault Injection

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/06-physical-degradation.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Partial**: Debouncing / RC / Warmup / I2C packet drops / PRNG are **Landed**; Fault domains & power models are **Stub** (Wave 3) |
| Supporting Axis | **A / F (secondary)** |
| Associated Code | `wink-micro-os/targets/common/{include,src}/wink_sim_physical.*`, `wink-micro-os/targets/wasm/pal_wasm_physical.c`, `wink-micro-os/targets/wasm/pal_hal_wasm.c`, `@wink-ai/unisim` (WasmPhysicalBridge degradation bridge) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0009, 0003, 0040 |
| Migrated From | `04-wasm-simulation-2.0/07-physical-degradation.md` |

> This document defines how simulation injects jitter, noise, warmup delays, and bus drops, why hybrid co-simulation is used, and how determinism is guaranteed.

---

## 1. Scope

**In Scope**:
- OSAL/HAL adapters in `wink-micro-os/targets/wasm/`;
- Target-agnostic algorithms in `wink-micro-os/targets/common/src/wink_sim_physical.c`;
- Browser UniSim Worker bridge and physical degradation modules (`@wink-ai/unisim`).

**Out of Scope**:
- ESP32/baremetal targets (**Zero binary pollution**);
- SPICE-level circuit simulation;
- Oscillator / crystal ppm drift (Non-goal);
- Preemptive multitasking.

---

## 2. Hybrid Dual-Domain Architecture (ADR-0009 Option C)

```text
┌─────────────────────────────────────────────────────────┐
│  JS Domain: Ideal physical quantities (Button press,    │
│             Distance 32cm, Temperature 25°C) + Config   │
└───────────────────────────┬─────────────────────────────┘
                            │ Worker Message Protocol / cwrap
                            ▼
┌─────────────────────────────────────────────────────────┐
│  C/Wasm Domain: Local signal degradation (Jitter,       │
│                 Packet drops, Gaussian noise)           │
│  Zero-cost memory reads; algorithms in wink_sim_physical│
└─────────────────────────────────────────────────────────┘
```

Macroscopic environmental events are managed in JS/UI, while microsecond-level signal degradations execute in C adjacent to read paths.

---

## 3. 3-Tier Fault Injection Discipline

| Tier | Location | Injected Behaviors | Upstream Visibility | Status |
|---|---|---|---|---|
| **L1 HAL Pin Middleware** (**Fault-L1**) | `pal_hal_wasm.c` (PinArbiter / Degradation Engine) | GPIO disconnects, debouncing jitter, pull-up failures | Transparent | Landed |
| **L2 Bus Middleware** (**Fault-L2**) | `pal_hal_wasm.c::pal_i2c_transfer` | I2C NACKs, SPI bit flips, bus timeouts | Transparent | Partial (I2C drops Landed) |
| **L3 Device Error Semantics** (**Fault-L3**) | **JS Plugin / `wasm_dev_*` / PAL injection** (Not DAL) | Sensor out-of-range, motor stall, bad EEPROM blocks | Explicit (Non-transparent) | Partial ~ Planned |

**Banned Anti-Patterns**:
- DAL drivers simulating disconnects internally;
- Per-peripheral duplicate jitter/noise algorithms (Must reuse L1/L2 common libraries);
- DAL directly manipulating PinArbiter or `setDriver`.

---

## 4. Target-Agnostic Algorithm Library (`wink_sim_physical.h`)

### 4.1 Fault Configuration Structure

```c
typedef struct {
    uint32_t bounce_us;          // Button bounce duration (0 = disabled)
    uint32_t warmup_us;          // Sensor power-on warmup period
    uint32_t sample_interval_us; // Minimum sample interval
    float    adc_noise_v;        // ADC noise amplitude ±V (0 = disabled)
    float    rc_tau_s;           // RC lowpass filter time constant
    uint16_t i2c_drop_permil;    // Bus packet drop rate in per-mille
    uint32_t prng_seed;          // Deterministic PRNG seed
} wink_sim_faults_t;

extern const wink_sim_faults_t WINK_SIM_FAULTS_IDEAL; // All zeros = Ideal passthrough
```

### 4.2 Algorithm API Inventory

| API | Semantics |
|---|---|
| `wink_phys_prng_next(seed)` | Deterministic LCG advancing `*seed` and returning $[0, 1)$ |
| `wink_phys_debounce_step(ctx, target, now_us, bounce_us)` | Debounce state machine returning degraded physical levels |
| `wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, seed)` | 1st-order RC filter + Gaussian noise without `expf` |
| `wink_phys_warmup_check(now_us, power_on_us, ...)` | Enforces warmup and minimum sampling intervals |
| `wink_phys_bus_drop(drop_permil, seed)` | Per-mille packet drop evaluator driven by PRNG |

### 4.3 Debouncing Model (Enforced Alternation)

```c
typedef struct {
    bool     stable_level;      // Last stable physical level
    bool     in_bounce;         // True while within bounce window
    uint64_t bounce_start_us;
    bool     bounce_flip;       // Toggled on each sample during bounce
} wink_phys_debounce_ctx_t;
```

Transitions trigger the debounce window, toggling `bounce_flip ^= 1` per sample for worst-case deterministic testing.

---

## 5. Wasm Degradation Engine (`pal_wasm_physical.c`)

### 5.1 BSS Memory Layout

```c
#define WASM_SIM_MAX_PINS 128
static wink_sim_faults_t s_faults;            // {0} = Ideal
static uint32_t          s_prng;
static wink_phys_debounce_ctx_t s_pin_ctx[WASM_SIM_MAX_PINS];
```

### 5.2 Exported C $\rightarrow$ JS APIs

| Symbol | Parameter $\leftrightarrow$ JS Type | Purpose |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | uint64 $\leftrightarrow$ BigInt | Virtual clock Gate |
| `pal_wasm_set_bounce_us` | uint32 $\leftrightarrow$ Number | Debounce duration |
| `pal_wasm_set_warmup_us` | uint32 | Warmup duration |
| `pal_wasm_set_sample_interval_us` | uint32 | Sampling interval |
| `pal_wasm_set_adc_noise_v` | float $\leftrightarrow$ Number | ADC noise |
| `pal_wasm_set_rc_tau_s` | float | RC time constant |
| `pal_wasm_set_i2c_drop_permil` | uint16 | Bus packet drop rate |
| `pal_wasm_set_prng_seed` | uint32 | PRNG seed initialization |
| `pal_wasm_get_prng_state` / `set_prng_state` | uint32 | State capture for replay |
| `pal_wasm_get_abi_hash` | uint32 | ABI layout lock |
| `pal_wasm_reset_physical` | — | Resets faults, PRNG, and pin states |

---

## 6. Cross-Language ABI Contracts

- CMake must pass `-sWASM_BIGINT=1` to bridge `uint64_t` $\leftrightarrow$ JS `bigint`.
- Worker Message Protocol supports `INIT`, `SET_FAULTS`, `STEP_CLOCK`, `SET_GPIO_IDEAL`, `READ_GPIO_DEGRADED`, and `TEST_I2C_TRANSFER`.

---

## 7. Global PRNG Architecture

A unified global PRNG state `s_prng` ensures single-seed 1:1 trace reproducibility ([ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)).

---

## 8. Floating-Point Determinism Contract (ADR-0055)

| Rule | Status |
|---|---|
| `-ffast-math` strictly prohibited on physical simulation paths | **Accepted Contract**; CI check **Planned** |
| Floating-point contraction contracts explicitly locked | **Planned** |
| Repeated executions on same toolchain and binary | Bit-exact (Test-L3) |
| Host vs Wasm golden traces | Default **tolerance** (`fp_mode=tolerance`) |

---

## 9. Testing Pyramid (Test-L*)

| Layer | Verification Content |
|---|---|
| Test-L0 Compilation | Clean builds across wasm/host/esp32/baremetal; zero TypeScript warnings |
| Test-L0.5 Static Architecture | Static assertions on `-sWASM_BIGINT=1` and absence of simulation symbols on physical targets |
| Test-L1 Unit Tests | Algorithmic golden vectors (Host vs Wasm tolerance) |
| Test-L2 Integration | End-to-end button debouncing |
| Test-L3 Determinism | 1000 consecutive runs yield zero byte-level deviation under identical seeds |

---

## 10. Degradation Fallback & Recovery

1. **Runtime Fallback**: `SET_FAULTS` with all-zero arguments restores ideal passthrough;
2. **Git Revert**: Reverting Wave 2 commits returns to the baseline;
3. **Build Layer**: Removing `pal_wasm_physical.c` excludes degradation from builds.

---

## 11. Historical Parameter Reference (ADR-0009)

| Parameter | Value |
|---|---|
| `BOUNCE_DURATION_US` | 10000 (10ms) |
| DHT11 Warmup | 1,000,000 µs |
| DHT11 Minimum Sampling Interval | 2,000,000 µs |
| ADC RC Tau | 0.05 s |
| ADC Noise | $\pm 0.02\text{ V}$ |
| JSON Fault Keys | `key_bounce_us`, `dht11_warmup_us`, `adc_noise_v`, `i2c_packet_drop_rate` |
