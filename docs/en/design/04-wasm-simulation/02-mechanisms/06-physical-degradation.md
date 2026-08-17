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
| **Landed** | **Partial**: Debouncing / RC / Warmup / I2C packet drops / PRNG are **Landed**; Fault domain isolation and power models are **Stub** (Wave 3) |
| Supporting Axis | **A / F (secondary)** |
| Associated Code | `wink-micro-os/targets/common/{include,src}/wink_sim_physical.*`, `wink-micro-os/targets/wasm/pal_wasm_physical.c`, `wink-micro-os/targets/wasm/pal_hal_wasm.c`, `@wink-ai/unisim` (WasmPhysicalBridge degradation bridge) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0009, 0003, 0040 |
| Migrated From | `04-wasm-simulation-2.0/07-physical-degradation.md` |

> This document answers: How simulation injects jitter, noise, warmup delays, and bus drops, why hybrid co-simulation is used, how determinism is guaranteed, and what the three-tier fault discipline is. Corresponds to Axes A/F and C1.3, C2.3, C7, C11.2.

---

## 1. Scope

**In Scope**:
- OSAL/HAL adaptation in `wink-micro-os/targets/wasm/`;
- Target-agnostic algorithm library `wink-micro-os/targets/common/src/wink_sim_physical.c` (shared between host PoC Wave 1 and Wasm sandbox);
- Browser-side UniSim Worker bridge and physical degradation modules (`@wink-ai/unisim`).

**Out of Scope**:
- ESP32 / baremetal physical targets (**Zero compilation pollution**, validated via grep);
- Electrical SPICE simulation;
- **Oscillator / crystal ppm drift** (Non-goal; consistent with [`02-virtual-clock.md`](./02-virtual-clock.md) C2.1 boundaries—do not conflate signal domain jitter with clock source drift);
- Preemptive multitasking scheduling (see [03](./03-scheduler-and-concurrency.md)).

---

## 2. Hybrid Double-Domain Architecture (ADR-0009 Option C)

```text
┌─────────────────────────────────────────────────────────┐
│  JS Domain: Ideal physical quantities (Button press,    │
│             Distance 32cm, Temperature 25°C) + Config   │
│             + Clock control; no micro-timing simulation │
└───────────────────────────┬─────────────────────────────┘
                            │ Worker Message Protocol / cwrap
                            ▼
┌─────────────────────────────────────────────────────────┐
│  C/Wasm Domain: Local signal degradation (Jitter,       │
│                 Packet drops, Gaussian noise)           │
│  Pure memory clock reads (zero boundary cost);          │
│  algorithms in wink_sim_physical                        │
└─────────────────────────────────────────────────────────┘
```

UI main thread ↔ UniSim Worker (VirtualClock bigint → WasmPhysicalBridge → SimWorker) ↔ Wasm sandbox (`pal_osal_wasm.c`, `pal_wasm_physical.c`, `pal_hal_wasm.c`, common algorithm library).

**Rationale for Partitioning**: Macroscopic speed-of-light changes (user pressing button, rotating potentiometer) are suitable for JS expression and require linkage with UI/3D scenes; microsecond-level signal degradations (button bounce, I2C packet drops) must execute on the C side close to the read path to influence shared-source DAL protocol logic.

---

## 3. Three-Tier Fault Injection Discipline (Mandatory)

| Tier | Location | Injected Content | Visibility to Upper Layer | Landing |
|---|---|---|---|---|
| **L1 HAL Pin Middleware** (**Fault-L1**) | `pal_hal_wasm.c` (via PinArbiter / Degradation Engine) | GPIO disconnects, debouncing jitter, pull-up/down failures, high impedance | Transparent | Landed |
| **L2 Bus Middleware** (**Fault-L2**) | `pal_hal_wasm.c::pal_i2c_transfer`, etc. | I2C ACK loss, SPI bit flips, bus timeouts | Transparent | Partial (I2C drops Landed; SPI bit flips Planned) |
| **L3 Device Error Semantics** (**Fault-L3**) | **JS Plugin / `wasm_dev_*` / PAL injection** (Not DAL) | Sensor out-of-range, motor stall, bad EEPROM blocks, and other **error codes or physical source anomalies** | Explicit (Non-transparent) | Partial ~ Planned |

**Prohibited Anti-Patterns**:
- DAL drivers simulating disconnects or returning business shortcuts internally in attachEvents/read/write;
- Each peripheral writing its own duplicate jitter/noise/drop routines (must reuse L1/L2 + `wink_sim_physical`);
- DAL directly calling PinArbiter / `setDriver` (L1/L2 is a PAL/HAL middleware responsibility);
- Adding new `dal/*_sim.c` or DAL `#ifdef SIMULATION` business stubs (conflicts with the single-source rule in [08](./08-channel-routing.md); historical thin wiring must be marked **Deprecated** and migrated out).

### 3.1 `wink_sim_physical` Responsibility Partitioning

| Partition | Content | Description |
|---|---|---|
| **Signal Degradation** | Debounce, RC, warmup, bus packet drop, PRNG | Subject of this document; shared algorithm between host/Wasm |
| **Plant Dynamics** | Differential equations for motors/rotors (if enabled) | Also in `wink-micro-os/targets/common`, **modules/symbols must be partitioned and isolated from signal degradation**; must not be embedded into DAL; see ADR-0047 / [`09-timer-and-pwm-semantics`](./09-timer-and-pwm-semantics.md) |

---

## 4. Target-Agnostic Algorithm Library (`wink_sim_physical.h`)

### 4.1 Fault Configuration

```c
typedef struct {
    uint32_t bounce_us;          // Button bounce duration (0 = disabled)
    uint32_t warmup_us;          // Sensor power-on warmup duration
    uint32_t sample_interval_us; // Minimum sample interval
    float    adc_noise_v;        // ADC noise amplitude ±V (0 = disabled)
    float    rc_tau_s;           // RC lowpass filter time constant (<=0 = disabled)
    uint16_t i2c_drop_permil;    // Bus packet drop rate in per-mille (0 = disabled)
    uint32_t prng_seed;          // Deterministic PRNG seed
} wink_sim_faults_t;

extern const wink_sim_faults_t WINK_SIM_FAULTS_IDEAL; // All zeros = Ideal passthrough
```

All zeros = Ideal passthrough (zero-overhead default, degradation path only activates after threshold check).

### 4.2 Algorithm APIs

| API | Semantics |
|---|---|
| `wink_phys_prng_next(seed)` | Deterministic LCG advancing `*seed` and returning [0,1); caller holds seed |
| `wink_phys_debounce_step(ctx, target, now_us, bounce_us)` | Debounce state machine returning degraded physical level |
| `wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, seed)` | 1st-order RC lowpass + Gaussian noise, discrete approximation **without expf** (no libm dependency) |
| `wink_phys_warmup_check(now_us, power_on_us, warmup_us, sample_interval_us, last_sample_us)` | Returns `WINK_ERR_BUSY` during warmup; `WINK_ERR_TIMEOUT` if sampled too frequently; otherwise OK |
| `wink_phys_bus_drop(drop_permil, seed)` | Per-mille packet drop determination driven by PRNG, true = drop |

### 4.3 Debounce Model (Forced Alternation)

```c
typedef struct {
    bool     stable_level;      // Last stable physical level
    bool     in_bounce;         // True while within bounce window
    uint64_t bounce_start_us;
    bool     bounce_flip;       // Toggled on each sample during bounce window (forced alternation)
} wink_phys_debounce_ctx_t;
```

- Level transition (target ≠ stable_level) enters the bounce window; within the window, each sample performs `bounce_flip ^= 1`, achieving **sample-period independent, 100% deterministic worst-case bounce**.
- **Model Revision**: The `(now/1000)%2` model in ADR-0009 skeleton silently failed under default `WINK_RUNTIME_TICK_MS=10` (quotient increased by 10 per tick, remaining perpetually even); revised to forced alternation.
- RC noise and bus packet drops still use PRNG.

### 4.4 Determinism Guardrails & Zero Pollution

- All timebases receive virtual clock values passed by caller; strictly prohibited from using `rand()`/`Math.random()`/`clock()`/`time()`/wall clock;
- This unit only enters the `pal_host` OBJECT library; ESP32/baremetal/Wasm do not directly link the algorithm library (Wasm calls common via `pal_wasm_physical.c`);
- No libm dependency (RC uses first-order discrete approximation);
- `SIM_TRACE=1` debug trace macros (`SIM_TRACE_DEBOUNCE/RC/WARMUP/BUS`) without changing algorithmic behavior.

---

## 5. Wasm Degradation Engine (`pal_wasm_physical.c`)

### 5.1 BSS State Layout (Zero Dynamic Allocation)

```c
#define WASM_SIM_MAX_PINS 128   // Covers ESP32-S3 (49) / Cortex-M (<100)
static wink_sim_faults_t s_faults;            // {0} = Ideal
static uint32_t          s_prng;
static wink_phys_debounce_ctx_t s_pin_ctx[WASM_SIM_MAX_PINS];
```

Relies on C11 §6.7.9 p10 BSS zero-initialization.

### 5.2 C→JS Exports (EMSCRIPTEN_KEEPALIVE, via cwrap)

| Symbol | Parameters ↔ JS Type | Purpose |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | uint64 ↔ bigint | (Virtual clock Gate, see [02](./02-virtual-clock.md)) |
| `pal_wasm_set_bounce_us` | uint32 ↔ number | Debounce duration |
| `pal_wasm_set_warmup_us` | uint32 | Warmup duration |
| `pal_wasm_set_sample_interval_us` | uint32 | Sampling interval |
| `pal_wasm_set_adc_noise_v` | float ↔ number | ADC noise |
| `pal_wasm_set_rc_tau_s` | float | RC time constant |
| `pal_wasm_set_i2c_drop_permil` | uint16 | Per-mille packet drop rate |
| `pal_wasm_set_prng_seed` | uint32 | PRNG seed |
| `pal_wasm_get_prng_state` / `set_prng_state` | uint32 | Regression / SessionRecorder replay |
| `pal_wasm_get_abi_hash` | uint32 | ABI layout lock (Bump on SimFaults/snapshot changes) |
| `pal_wasm_reset_physical` | — | Resets faults/PRNG/per-pin ctx/fault domains/latches (equivalent to runtime BSS zero-init) |

PRNG stepping: HAL middleware executes `get_prng_state → pass to algorithm → advance_prng_state write back`.

### 5.3 Boundary Safety

- Per-pin access: `if ((unsigned)pin >= WASM_SIM_MAX_PINS) return /* passthrough */;`—No BSS out-of-bounds; out-of-bounds pins are treated as undegraded (observable passthrough, superior to silent crash);
- `get_debounce_ctx` returning NULL on out-of-bounds causes HAL to treat that pin as undegraded;
- This represents a "zero dynamic allocation + static upper bound" design, not a memory safety defect.

---

## 6. Cross-Language Contracts

### 6.1 BigInt ABI

- CMake must link with `-sWASM_BIGINT=1`, otherwise uint64 is split into two i32 values;
- Passing `number` to a bigint export in JS throws `TypeError` (runtime safeguard for TS compile-time checks);
- Clock/time fields across TS must strictly use `bigint`.

### 6.2 Worker Message Protocol (SimWorker.ts)

| Request | Fields | Wasm Invocation |
|---|---|---|
| `INIT` | — | bind Module + reset VirtualClock + `pal_wasm_reset_physical` |
| `SET_FAULTS` | `faults: SimFaultsConfig` | Batch-invokes all `pal_wasm_set_*` |
| `STEP_CLOCK` | `us: bigint` | `pal_wasm_advance_virtual_clock(us)` |
| `SET_GPIO_IDEAL` | `pin, level` | Writes Wasm-side ideal level |
| `READ_GPIO_DEGRADED` | `pin` | `pal_gpio_read(pin)` (including debounce) |
| `TEST_I2C_TRANSFER` | `port, devAddr, writeBuf, readLen` | `pal_i2c_transfer()` (including packet drops) |

Every message carries `id: number` for response correlation (frontend `await` for single round-trip).

---

## 7. Global PRNG Architecture (Deliberate Design)

A single global `s_prng` is an architectural decision, not a defect: ADR-0009 §4.1 mandates "one seed → 1:1 whole trace". Per-peripheral PRNGs would explode seed spaces. In the future, `hash(global_seed, peripheral_id)` may derive independent sub-streams, but the current global seed suffices for deterministic regression.

**Golden Stability Implications (Important)**: Any change in the **order of PRNG consumption** by HAL/middleware will silently alter all downstream traces and break cross-version golden vectors. Conventions:

- Golden vectors **bind to code versions**; refactoring consumption order → **must re-baseline** golden vectors, rather than assuming legacy vectors remain valid;
- Domain IDs / sub-stream derivation (stable `peripheral_id`) is **Planned** (governed by discipline + version binding until implemented).

---

## 8. Floating-Point Determinism Contract ([ADR-0055](../../../decisions/unisim/0055-sim-fp-determinism-and-golden-policy.md))

`wink_phys_rc_lowpass` avoids drift-prone libm calls like `expf`, but FPU semantics between **host (x86-64) vs Wasm** are not naturally bit-exact.

| Rule | Status |
|---|---|
| Prohibit `-ffast-math` on physical algorithms / golden paths (host gcc and emcc) | **Accepted Contract**; build verification **Planned** |
| Lock / declare FP contracts (avoid implicit FMA contraction causing cross-ISA drift) | **Planned** |
| **Identical** toolchain + **identical** binary repeated executions | Bit-exact claimed (Test-L3 "1000 runs zero deviation" applies only here) |
| **Host vs Wasm** golden | Default **tolerance** (`fp_mode=tolerance`); upgrading to bit-exact requires separate proof |
| Intermediate variables use float vs double | Algorithm implementation must fix and document in unit test comments |

Tolerance table initial version is **Planned** (assurance / unit test header). Execution details SSOT: ADR-0055.

> **Terminology**: "Test Matrix Test-L0–L3" in this section ≠ Fault Injection Tiers Fault-L1–L3 (§2) ≠ Accuracy Evidence Levels Evidence-L1/L2 ([`11`](./11-accuracy-observation-lifecycle.md)). Disambiguation in [`05-glossary.md`](../01-overview/05-glossary.md).

---

## 9. Testing Matrix

| Tier (**Test-L***) | Content |
|---|---|
| Test-L0 Compilation | Clean builds across wasm/host/esp32/baremetal; `tsc --noEmit` zero warnings |
| Test-L0.5 Static Architecture | grep asserts `pal_delay_ms` body does not call advance; `-sWASM_BIGINT=1` in link flags; `WASM_SIM_MAX_PINS` boundary checks exist; physical targets contain no `wink_sim_physical` symbols |
| Test-L1 C Unit Tests | Algorithmic golden vectors: Bit-exact within same toolchain; host vs Wasm per §8 tolerance |
| Test-L1 TS Unit Tests | VirtualClock bigint boundaries / negative rejection; WasmPhysicalBridge setter ordering; SimWorker dispatch |
| Test-L2 Integration | End-to-end button debouncing wasm ↔ host (tolerance or toolchain baseline) |
| Test-L3 Determinism | Same seed + same input + **identical binary** → byte-identical; zero deviation across 1000 consecutive runs |

### Zero Compilation Pollution Validation (Continuous)

`grep wink_sim_physical|pal_wasm_physical targets/esp32 targets/baremetal` must return empty. Algorithm sources are compiled exclusively by `pal_host` and `pal_wasm` CMake OBJECT libraries; ESP32/baremetal CMakeLists explicitly enumerate source files (no globs).

---

## 10. Degradation Fallback & Rollback

1. **Runtime Fallback**: `SET_FAULTS` with all zeros → all degradation bypassed after threshold checks, passthrough without recompilation;
2. **Git Revert**: Reverting Wave 2 commits returns to baseline (algorithm sources retained, Wasm setters/middleware removed);
3. **Compile-Time**: Remove `pal_wasm_physical.c` from `pal_wasm` CMake and restore `pal_gpio_read`/`pal_i2c_transfer` degradation.

---

## 11. Historical Parameter Reference (ADR-0009, Sample Devices)

| Parameter | Value |
|---|---|
| `BOUNCE_DURATION_US` | 10000 (10ms) |
| DHT11 Warmup | 1,000,000 µs |
| DHT11 Minimum Sampling Interval | 2,000,000 µs |
| ADC RC Tau | 0.05 s |
| ADC Noise | ±0.02 V |
| JSON Fault Keys | `key_bounce_us`/`dht11_warmup_us`/`adc_noise_v`/`i2c_packet_drop_rate` |

> Fault domain isolation and power models are Wave 3 stubs, see [05 §5](./05-memory-and-faults.md).
