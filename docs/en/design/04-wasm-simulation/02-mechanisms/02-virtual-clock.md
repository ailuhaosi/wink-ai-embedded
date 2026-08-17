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
| **Landed** | **Landed** (`s_virtual_us` Single Gate / HEADLESS fast-forward / bigint); Zero-yield pulse-in loopback is **Partial** for ultrasonic (target path, see [08 §5.1](./08-channel-routing.md)) |
| Supporting Axis | **B (primary)** |
| Associated Code | `wink-micro-os/osal/wasm/pal_osal_wasm.c`, `wink-micro-os/targets/common/src/wink_sim_physical.c`, `@wink-ai/unisim` (VirtualClock engine) |
| Last Audit | 2026-08-02 |
| Governing ADRs | [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md) (Decision 3), [0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md) |
| Migrated From | `04-wasm-simulation-2.0/03-virtual-clock.md` |

> This document answers: What clock governs delays/timeouts/pulse widths, how the clock advances, why dual stepping is forbidden, and how long-duration tests finish in milliseconds. Corresponds to C2, C14, C21.

---

## 1. Virtual Microsecond Clock SSOT

### 1.1 Design Principles

Simulation completely abandons host wallclocks (`Date.now`/`setTimeout`), adopting a monotonically increasing virtual microsecond clock `s_virtual_us` (`uint64_t`) as the sole SSOT ([ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)):

- **Zero-Duration Fast-Forwarding**: In HEADLESS mode when all Fibers are in sleep/waiting states, `pal_sim_scheduler_run` fast-forwards `s_virtual_us` to the nearest `next_wakeup_us`, finishing long temporal tests in milliseconds;
- **Bound Physical Logic**: `wink_phys_debounce_step`, `wink_phys_rc_lowpass`, and software timers are all anchored to `s_virtual_us`, ensuring deterministic reproduction across host machines;
- **Zero-Cost Reads**: `pal_os_get_us()` / `pal_os_get_ms()` perform pure memory reads without JS round-trips.

### 1.2 Single Assignment Gate (R-VC-1, ADR-0042)

| Role | Description |
|---|---|
| Clock Storage | `wink-micro-os/osal/wasm/pal_osal_wasm.c::s_virtual_us` (BSS zero-initialized, monotonic uint64) |
| Sole Assignment Point | Static private `wink_vclock_advance_internal()` |
| Legitimate Caller 1 | C→JS export `pal_wasm_advance_virtual_clock(us)` (JS Worker steps in INTERACTIVE mode) |
| Legitimate Caller 2 | HEADLESS scheduler idle jump (through the same Gate) |
| **Forbidden** | Active stepping inside `pal_delay_ms/us`; direct assignment to `s_virtual_us` by any other code |

> Difference from older documentation: Section 06 previously stated "JS Worker is the sole writer"—after ADR-0042, this was updated to "**Single Gate, two legitimate callers**". The JS-side `VirtualClock` is an equivalent bigint mirror used for UI scheduling and timeline replay; Wasm acts as the clock arbiter, and both sides do not reconcile microsecond by microsecond, synchronizing strictly on `pal_wasm_reset_physical()` + `VirtualClock.reset()`.

### 1.2.1 Plugin / JS Clock Reading & Pin Event Injection Contract

| Rule | Description |
|---|---|
| **Arbiter** | C `s_virtual_us`; exported as `pal_wasm_get_virtual_clock_us()` / `pal_os_get_us()` |
| **Before Plugin Schedules Future Edge** | **Must** read C clock via cwrap to compute `delay_us`; **forbidden** to rely solely on JS `VirtualClock.getUs()` mirror (mirror may lag behind C, creating skew windows) |
| **`pal_wasm_push_pin_event(pin, delay_us, level)`** | Enqueue absolute timestamp = `pal_os_get_us() + delay_us` (based on C clock at moment of push) |
| **Target Expired** (`delay_us==0` or clock passed target after enqueue) | `pulse_in`: Returns pulse width if edge pairs match; only advances if `t_end > now`, never rolls backward ([ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md)) |
| **Same-Timestamp Total Order with Scheduling** | Pin Event = **pull**; does not enter Phase 2; fast-forward does not dispatch ISR → [`03` §3.1](./03-scheduler-and-concurrency.md) |

### 1.3 Type Contract

- CMake `-sWASM_BIGINT=1`: Bridges `uint64_t` ↔ JS `bigint` with exact precision;
- All TypeScript timeline clock fields must strictly be `bigint`, prohibiting implicit `number` (passing `number` to a bigint export throws `TypeError`, acting as a runtime safeguard);
- uint64 range spans >580 years, unreachable; overflow warnings in §4.

---

## 2. Zero-Yield Synchronous Event-Driven Fast-Forwarding

### 2.1 Problem

Naive pin timing loopbacks yielding via Asyncify on `pal_gpio_pulse_in` slow down execution by **10~50×** due to unwind/rewind overhead.

### 2.2 Mechanism (Pin Event Queue)

1. **Pin Event Queue**: C side maintains a linked list of scheduled "future pin transitions" (`pal_wasm_push_pin_event(pin, delay_us, level)`);
2. **Zero-Yield Callback**: When Trig transitions, it invokes a synchronous plugin callback, and the plugin writes Echo edge timestamps into the queue;
3. **Synchronous Clock Advance**: `pulse_in` directly accumulates `s_virtual_us` and returns pulse width, **Asyncify yield count = 0** (HEADLESS path).

This is the target landing point for ultrasonic pulse width measurement (replacing the deprecated C-side cm→µs shortcut, see [08 §5.1](./08-channel-routing.md)).

### 2.3 Known Side Effects

Fast-forward jumps may skip intermediate edges or leap past half a debounce window—contracts and escapes fall under C14.2: Pending pin events / physical steps must be drained before jumping, or fast-forward must pick the global "next event" timestamp.

---

## 3. Physical Algorithms Anchored to Virtual Time

In `wink-micro-os/targets/common/src/wink_sim_physical.c` (target-independent algorithm library shared by host and Wasm), all timebases receive virtual clock values passed by caller via `pal_get_us()`:

| Algorithm | API | Time Anchor |
|---|---|---|
| Button Debounce (Forced Transition Model) | `wink_phys_debounce_step(ctx, target, now_us, bounce_us)` | `now_us` = Virtual clock |
| RC 1st-Order Lowpass + Noise | `wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, seed)` | Same as above |
| Warmup / Sample Interval Check | `wink_phys_warmup_check(now_us, power_on_us, ...)` | Same as above |
| Bus Packet Drop | `wink_phys_bus_drop(drop_permil, seed)` | PRNG driven |

**Determinism Redline**: Strictly prohibited from using `rand()`/`Math.random()`/`clock()`/`time()`/wall clock; PRNG is a seed-driven LCG (`wink_phys_prng_next`), with the caller holding the seed. See details in [06](./06-physical-degradation.md).

---

## 4. Clock Overflow & Wrap-Around

- `s_virtual_us` is uint64 with >580 years range, practically unreachable; early warning is still provided: `pal_wasm_is_clock_warning_fired()` sets and latches upon passing the UINT64 midpoint (polled every tick by JS Worker, `console.warn` on first true), clearing only when the Wasm instance restarts.
- **Application-managed uint32 ticks/milliseconds must still test wrap-around** (C21.1): `now - last` must compute via unsigned subtraction. Unit tests must fast-forward across rollover boundaries.
- Relative timeouts crossing fast-forwards: Internally use absolute `wakeup_us` throughout, rather than "remaining delta" (C21.2).

---

## 5. Clock-Related Escape Index (See [../04-assurance/01-consistency-spec.md](../04-assurance/01-consistency-spec.md) for Details)

| ID | Scenario | Key Points |
|---|---|---|
| C2.1 | Sleep/Timer Wakeup Fast-Forward | Same seed / same registration order → reproducible wakeup sequence; wall-clock duration ≪ virtual span |
| C2.2 | Pulse-In Zero-Yield Loopback | Asyncify count = 0; returns within tolerance |
| C2.3 | Debounce/RC Anchored to Virtual Clock | Fixed input → golden vector consistency |
| C2.4 | Single Interrupt Sample Period | Zero period error without injection; controlled jitter injectable |
| C14.1 | Ban Dual Stepping | CI asserts unique assignment Gate |
| C14.2 | Fast-Forward Does Not Drop Edges | Drain events / global minimum event time |
| C14.3 | Plant↔OS Lockstep | Plant prohibited from reading wall clock, shares virtual_dt |
| C21 | Time/Counter Wrap-Around | uint32 rollover, absolute wakeups, sequence modulus |

**Currently not simulating crystal oscillator / clock source ±50ppm drift** (non-goal; C2.1 boundary). If required in the future, a work item must first be opened in [`06-physical-degradation.md`](./06-physical-degradation.md)—no such operator currently exists, and documentation must not imply that "the degradation engine can already inject ppm".
