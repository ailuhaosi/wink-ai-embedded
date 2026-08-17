# Memory Quotas, OOM, Fault Latching & Sanitizers

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/05-memory-and-faults.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Partial**: Fault latching / safe-off / host_fault are **Landed**; Fixed heap quota (ADR-0045 linker flags) is **Planned**; Fault domains & power models are **Stub** |
| Supporting Axis | **F (primary)** |
| Associated Code | `wink-micro-os/targets/wasm/pal_wasm_fault.c`, `wink-micro-os/targets/wasm/pal_wasm_fault_domain.c`, `wink-micro-os/targets/wasm/pal_wasm_internal.h`, `wink-micro-os/targets/wasm/wasm_bridge.h` |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0024 (safe-off), 0045, 0012 (Honest contracts), 0042 |
| Migrated From | `04-wasm-simulation-2.0/06-memory-and-faults.md` |

> This document defines simulation heap sizing, OOM handling, fault latching with safe-off execution, host exception trapping, and ASan/UBSan sanitizer layers.

---

## 1. Memory Quotas & OOM (ADR-0045)

### 1.1 Design Principles

- Memory quotas are enforced at the **target build layer**, never inside platform-agnostic `pal/` sources (avoiding custom `pal_malloc` pollutions).
- The default simulation heap quota (**256 KiB**) serves as a **Simulation Assertion Baseline** to detect leaks and missing NULL checks, not as a physical mirror of ESP32 DRAM.

### 1.2 Wasm Implementation & Landing Status

ADR-0045 mandates capping physical memory via Emscripten linker flags:

```text
-sINITIAL_MEMORY=${WINK_SIM_MEMORY_BYTES}
-sMAXIMUM_MEMORY=${WINK_SIM_MEMORY_BYTES}
-sALLOW_MEMORY_GROWTH=0
```

> **Landing Status (2026-08-02 Audit)**: Fixed heap caps are **Planned**; current Wasm builds allow memory growth until flags land.

OOM Error Path: Failed allocations trigger `pal_wasm_invoke_fault(WINK_ERR_NO_MEM)` (code **-13**), record in the Fault Ring Buffer, and execute `app_on_fault()` for failsafe isolation.

### 1.3 Host & Hardware Targets

- Host Native: Wraps allocations via `-Wl,--wrap=malloc` during host simulation runs.
- Hardware Targets: Employs standard FreeRTOS heap allocators without simulation wrappers.
- Application/BAL layers must enforce static object pools.

### 1.4 BSS Zero-Values $\neq$ Semantic Defaults

BSS zero-initialization guarantees numeric 0, not semantic defaults. Structures with non-zero defaults (e.g., `armed = true`) must explicitly initialize during `pal_wasm_reset_physical()`.

---

## 2. Fault Latching & Safe-Off Sequencing

### 2.1 Latch State Machine

`pal_wasm_fault.c` manages `static bool s_wasm_faulted`:

| API | Behavior |
|---|---|
| `pal_wasm_is_faulted()` | Queries fault state (Getter remains valid while faulted) |
| `pal_wasm_invoke_fault(code)` | **Internal** fault trigger (WCET watchdog code 8002). Latches + traces + safe-off + `on_fault`. Idempotent |
| `pal_wasm_host_fault(code, msg)` | **Host $\rightarrow$ C** fault (JS safeWrap caught plugin exception, code 8003) |
| `pal_wasm_clear_fault_latch()` | Clears latch and resets App callback references |
| `pal_wasm_fault_set_callbacks(cb)` | Rebinds scheduler callback handlers |

Simulation & Host Fault Codes (8xxx Series):

| Code | Meaning | Source | Status |
|---|---|---|---|
| 8001 | Boot-reset | Reserved | **Partial ~ Planned** |
| 8002 | WCET timeout (Timeslice exceeded, default 5ms wallclock) | `pal_wasm_invoke_fault` $\leftarrow$ Scheduler | **Landed** |
| 8003 | JS host plugin fault (Plugin exception / Promise rejection) | `pal_wasm_host_fault` $\leftarrow$ safeWrap | **Landed** |
| -13 | `WINK_ERR_NO_MEM` (OOM) | Memory quota exhaustion | **Planned** (ADR-0045) |

### 2.2 Safe-Off Sequence

Upon the initial fault event:
1. Latch `s_wasm_faulted = true`;
2. Record `wink_trace_fault(code)` into audit ring;
3. Shut down all actuators via `wink_actuator_safe_off_all()` ([ADR-0024](../../../decisions/core/0024-app-blocking-api-honesty-pragma-convention.md));
4. Invoke `on_fault(code)` callback if registered.

### 2.3 Fast-Fail Guards

While faulted, state-mutating `pal_wasm_*` exports return immediately via guard macros:

```c
WASM_FAULT_GUARD_VOID()    // → if (faulted) return;
WASM_FAULT_GUARD_WINKERR() // → if (faulted) return WINK_ERR_INVALID_STATE;
WASM_FAULT_GUARD_BOOL()    // → if (faulted) return false;
```

---

## 3. Host $\rightarrow$ C Exception Trapping (`safeWrap`)

Host JS import factories wrap external calls with `safeWrap`/`safeWrapAsync`:
- Traps uncaught exceptions and Promise rejections in custom plugins;
- **Always returns a resolved Promise** to prevent Emscripten runtime panics;
- Marshals errors to `pal_wasm_host_fault(8003, msg)`.

---

## 4. Fault Audit Ring Buffer

`pal_wasm_physical.c` maintains a **256-entry** circular log recording physical faults (GPIO bounce, I2C drops):

```c
typedef struct {
    uint64_t timestamp_us;   // Synchronized with pal_os_get_us()
    uint8_t  fault_type;     // wasm_fault_type_t
    uint16_t pin_or_bus;     // GPIO pin or I2C bus index
    uint32_t sequence;       // Monotonically increasing sequence number
} wasm_fault_event_t;
```

---

## 5. Fault Domains & Power Modeling (Stubs)

`wink-micro-os/targets/wasm/pal_wasm_fault_domain.c` contains frozen ABI stubs:
- **Fault Domains**: `WASM_FAULT_DOMAIN_GLOBAL/GPIO/I2C0/I2C1/SPI0/CLOCK/COUNT` return global `s_faults` singleton;
- **Power Modeling**: `wasm_pin_power_model_t` stubs parameter validation without accumulation.

---

## 6. ASan / UBSan Sanitization

- ASan runs as **Pass 3** in test pipelines (`python wink-tools/wink.py test`);
- UBSan captures signed integer overflows, alignment errors, and NaN propagations;
- Full ASan runs under Clang/Emscripten host and CI environments.

| Defect Class | Sanitizer Tool | Scenario |
|---|---|---|
| Use-After-Free / Buffer Overflows | AddressSanitizer (ASan) | C6.3 |
| Unaligned Access / Integer UB | UndefinedBehaviorSanitizer (UBSan) | C12.4 / C25 |
| Race Conditions | ThreadSanitizer (TSan) | C3 |
| Stack Overflow | `STACK_OVERFLOW_CHECK=2` + Watermarks | C6.5 |
