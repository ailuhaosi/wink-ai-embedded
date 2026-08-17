# Virtual Clock SSOT, Zero-Yield Fast-Forwarding & Time Wrap-Around

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/02-virtual-clock.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Landed** (`s_virtual_us` Single Gate / HEADLESS fast-forward / bigint); Zero-yield pulse-in loopback is **Partial** (Target path, see [08 §5.1](./08-channel-routing.md)) |
| Supporting Axis | **B (primary)** |
| Associated Code | `wink-micro-os/osal/wasm/pal_osal_wasm.c`, `wink-micro-os/targets/common/src/wink_sim_physical.c`, `@wink-ai/unisim` (VirtualClock engine) |
| Last Audit | 2026-08-02 |
| Governing ADRs | [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md) (Decision 3), [0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md) |
| Migrated From | `04-wasm-simulation-2.0/03-virtual-clock.md` |

> This document defines what clock governs delays/timeouts/pulses, how the clock advances, why dual stepping is forbidden, and how long-duration tests finish in milliseconds.

---

## 1. Virtual Microsecond Clock SSOT

### 1.1 Design Principles

Simulation abandons host wallclocks (`Date.now`/`setTimeout`), adopting a monotonically increasing virtual microsecond clock `s_virtual_us` (`uint64_t`) as the sole SSOT ([ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)):

- **Zero-Duration Fast-Forwarding**: In HEADLESS mode when all fibers are asleep, `pal_sim_scheduler_run` leaps `s_virtual_us` directly to the nearest `next_wakeup_us`, finishing long tests in milliseconds;
- **Bound Physical Logic**: Debouncing (`wink_phys_debounce_step`), RC lowpass filters (`wink_phys_rc_lowpass`), and soft timers are anchored to `s_virtual_us`, ensuring deterministic cross-host reproducibility;
- **Zero-Cost Reads**: `pal_os_get_us()` / `pal_os_get_ms()` execute pure memory reads without JS round-trips.

### 1.2 Single Assignment Gate (R-VC-1, ADR-0042)

| Role | Description |
|---|---|
| Clock Storage | `wink-micro-os/osal/wasm/pal_osal_wasm.c::s_virtual_us` (BSS zero-initialized, monotonic uint64) |
| Sole Assignment Point | Static private `wink_vclock_advance_internal()` |
| Legitimate Caller 1 | Exported `pal_wasm_advance_virtual_clock(us)` (JS Worker in INTERACTIVE mode) |
| Legitimate Caller 2 | HEADLESS scheduler idle jump (Through the same Gate) |
| **Forbidden** | Active stepping inside `pal_delay_ms/us`; direct assignments to `s_virtual_us` |

### 1.2.1 Plugin Clock Reading & Pin Event Injection Contract

| Rule | Description |
|---|---|
| **Authoritative Clock** | C `s_virtual_us`; read via `pal_wasm_get_virtual_clock_us()` / `pal_os_get_us()` |
| **Scheduling Future Edges** | **Must** read C clock via cwrap to compute `delay_us`; **never** rely solely on JS `VirtualClock.getUs()` |
| **`pal_wasm_push_pin_event`** | Absolute event timestamp = `pal_os_get_us() + delay_us` (Timestamped at injection) |
| **Expired Targets** (`delay_us==0`) | Pulse matching returns width; advances if `t_end > now`; never rolls backward ([ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md)) |

### 1.3 Type Contracts

- CMake `-sWASM_BIGINT=1`: Bridges `uint64_t` $\leftrightarrow$ JS `bigint` without precision loss;
- TypeScript clock fields must strictly use `bigint`.

---

## 2. Zero-Yield Synchronous Event-Driven Fast-Forwarding

### 2.1 Problem

Naive pin loopbacks yielding via Asyncify on `pal_gpio_pulse_in` slow down execution by **10–50x** due to stack unwind/rewind overhead.

### 2.2 Pin Event Queue Mechanics

1. **Pin Event Queue**: C maintains a linked list of scheduled pin transitions (`pal_wasm_push_pin_event(pin, delay_us, level)`);
2. **Zero-Yield Callback**: Trigger transitions invoke synchronous plugin callbacks, pushing Echo edge timestamps into the queue;
3. **Synchronous Leap**: `pulse_in` advances `s_virtual_us` synchronously and returns pulse width with **Zero Asyncify yields** (HEADLESS path).

---

## 3. Physical Algorithms Anchored to Virtual Time

All temporal routines in `wink-micro-os/targets/common/src/wink_sim_physical.c` receive timestamps from caller-supplied `pal_get_us()` values:

| Algorithm | API | Time Anchor |
|---|---|---|
| Button Debouncing | `wink_phys_debounce_step(ctx, target, now_us, bounce_us)` | `now_us` = Virtual clock |
| RC 1st-Order Filter + Noise | `wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, seed)` | Same |
| Warmup / Sample Check | `wink_phys_warmup_check(now_us, power_on_us, ...)` | Same |
| Bus Packet Drop | `wink_phys_bus_drop(drop_permil, seed)` | Seeded PRNG driven |

**Determinism Rule**: Direct calls to `rand()`, `Math.random()`, `clock()`, or `time()` are strictly forbidden. PRNGs must use seeded LCG generators (`wink_phys_prng_next`).

---

## 4. Clock Overflow & Wrap-Around

- `s_virtual_us` (uint64) spans >580 years; warning flag `pal_wasm_is_clock_warning_fired()` triggers after passing the uint64 midpoint.
- **Application uint32 ticks must test wrap-around** (C21.1): Differences must compute via unsigned arithmetic (`now - last`).
- Timeouts spanning fast-forward jumps use absolute timestamps (`wakeup_us`), avoiding relative deltas.

---

## 5. Clock Escape Index

| ID | Scenario | Summary |
|---|---|---|
| C2.1 | Sleep / Wakeup Fast-Forward | Seed + registration order $\rightarrow$ reproducible wakeup sequences |
| C2.2 | Pulse-In Zero-Yield Loopback | Asyncify count = 0; returns within tolerance |
| C2.3 | Debounce/RC Anchored to Clock | Fixed input $\rightarrow$ identical golden trace vector |
| C2.4 | Single Interrupt Sample Period | Zero nominal jitter; controlled injected jitter |
| C14.1 | Ban Dual Stepping | CI asserts single assignment Gate |
| C14.2 | Fast-Forward Preserves Edges | Drains pending pin events prior to jump |
| C14.3 | Plant $\leftrightarrow$ OS Lockstep | Plant prohibited from reading wallclock |
| C21 | Time Wrap-Around | Tests uint32 rollover, absolute wakeups |
