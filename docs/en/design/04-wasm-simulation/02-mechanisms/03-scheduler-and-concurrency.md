# Cooperative Scheduler, Concurrency Model & Blocking Gates

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/03-scheduler-and-concurrency.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Landed** (Cooperative RR scheduling / Fibers / WCET / HEADLESS jumps); Chaotic PRNG interleaving is **Planned** (Task 7); SMP is **Planned** (Requires new ADR, currently rejected) |
| Supporting Axis | **E (primary)**; **D (secondary)** — Phase 0 / tick-driven Poll & total order |
| Associated Code | `wink-micro-os/targets/common/{include,src}/wink_sim_scheduler.*`, `wink-micro-os/targets/common/include/sim_ctx.h`, `wink-micro-os/osal/{wasm,host}/pal_osal_*.c` |
| Last Audit | 2026-08-02 |
| Governing ADRs | [0007](../../../decisions/core/0007-cooperative-loop-execution-model.md), [0012](../../../decisions/core/0012-contract-honesty-over-silent-degradation.md), [0013](../../../decisions/unisim/0013-sim-cooperative-scheduler.md), [0014](../../../decisions/unisim/0014-sim-single-virtual-core.md), [0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md), [0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md) |
| Migrated From | `04-wasm-simulation-2.0/04-scheduler-and-concurrency.md` |

> This document answers: How multi-tasking is expressed on a single Wasm stack, task state machines, determinism guarantees, WCET watchdog fallback, synchronization primitive semantics, SMP boundaries, and STRICT_NONBLOCKING gates. Corresponds to Axis E and C3/C5/C9/C16.

---

## 1. Objectives & Execution Model

Replaces synchronous degenerate direct calls in `pal_os_task_create` with a **deterministic cooperative scheduler** shared across host and Wasm targets. Goals:

1. Multi-task concurrency (`while(1){sleep;}` + ring buffer producer/consumer);
2. Bit-exact determinism (Identical registration order + yield patterns → 100% reproducible execution);
3. Zero deployment friction (Single-threaded Wasm, avoiding SharedArrayBuffer / COOP / COEP requirements);
4. App-level API parity with ESP32 FreeRTOS (`pal_os_task_create` / `pal_os_sleep_ms` / `pal_os_ringbuf`).

**Core Trade-off**: Context switches occur exclusively at explicit yield points (`pal_os_sleep_ms`, `pal_os_mutex_lock`, etc.). Pure CPU compute sequences are non-preemptible (see §6 boundaries).

---

## 2. Task State Machine

```text
INVALID → READY → WAITING/BLOCKED → READY → ZOMBIE → TERMINATED → (Slot Reuse) READY
```

| State | Meaning | Writer |
|---|---|---|
| `INVALID` | Slot unallocated (memset 0) | `sim_scheduler_reset` |
| `READY` | Runnable; eligible for selection | register / wakeup_by_time / resume |
| `WAITING` | Timed sleep (`sleep_ms`, `wakeup_us>0`) | `yield_timed` |
| `BLOCKED` | Blocked on mutex/queue/semaphore; `timeout_fired` allows `mutex_lock` to return TIMEOUT | `block` |
| `ZOMBIE` | Self-deleted; fiber awaiting main scheduler GC | `mark_zombie` |
| `TERMINATED` | Freed; slot available for reuse | `gc_zombies` |

Task Structure (`wink_sim_scheduler.h`, `_Static_assert(sizeof <= 96)`):

```c
typedef struct {
    void   (*func)(void*);
    void*    arg;
    int32_t  priority;
    int32_t  core_id;           /* Recorded but unused for scheduling (ADR-0014) */
    uint64_t wakeup_us;         /* 0=No timeout; >0=Enforced READY at deadline */
    uint32_t blocked_on;        /* 0=Unblocked; >0=Resource ID */
    bool     timeout_fired;     /* Cleared on resume; evaluated by mutex_lock for TIMEOUT */
    sim_task_state_t state;
    uint32_t id;                /* Monotonically allocated */
    char     name[16];
    sim_ctx_t* ctx;             /* Target coroutine context handle */
} sim_task_t;
```

Capacity Limits and Stack Floors:

| Constant | Value | Description |
|---|---|---|
| `WINK_SIM_MAX_TASKS` | 8 | Maximum concurrent tasks |
| `WINK_SIM_TASK_WCET_THRESHOLD_US` | 5000 (5ms) | Default WCET watchdog threshold |
| `WINK_SIM_STACK_MIN` (Wasm / Host) | 16 KiB / 32 KiB | User `stack_depth` is a **floor**; values below this clamp up with a WARN |
| `WINK_SIM_ASYNCIFY_MIN` (Wasm) | 2 KiB | Asyncify stack buffer floor |

---

## 3. Main Scheduler Loop (`pal_sim_scheduler_run`)

```text
loop while (main_task not TERMINATED and ticks < max_ticks):
  [Phase 0] wasm: pal_wasm_dispatch_pending_interrupts()   # Drains JS IRQs → C soft IRQs
  [Phase 1] sim_scheduler_gc_zombies()                     # ZOMBIE→TERMINATED, destroys fiber
  [Phase 2] sim_scheduler_wakeup_by_time(now_us)           # Expired WAITING/BLOCKED → READY
  [Phase 3] next = sim_scheduler_pick_next()
            If no READY task:
              INTERACTIVE → js_pal_os_sleep_ms yields (JS advances clock)
              HEADLESS    → Skips s_virtual_us to next_wakeup_us via Single Gate; continue
            If READY task found:
  [Phase 4] set_current(next)
            wall_start = host_wall_clock_us()              # Physical wallclock check (Redline 11)
            sim_ctx_switch(main_ctx, task_ctx)
            set_current(NO_READY)                          # Redline 15
            duration = wall_now - wall_start
            if duration > wcet_threshold: wink_runtime_fault(callbacks, 8002)
            if next == main_task_id: ticks_run++
```

- **Phase 0 IRQ Dispatch** is executed on Wasm only (no-op on host), see [04-interrupt-model](./04-interrupt-model.md).
- **HEADLESS Mode without READY tasks** bypasses Asyncify, leaping clock directly (ADR-0042) and **bypassing WCET 8002** (instant virtual time jumps render wall-clock comparisons meaningless).
- `callbacks` (`struct wink_app_callbacks*`) pass through to `wink_runtime_fault` to trigger App `on_fault` ([ADR-0012](../../../decisions/core/0012-contract-honesty-over-silent-degradation.md) contract honesty); NULL is permitted (testing scenarios). PAL headers only use forward declarations and ban including `wink_app.h`/`wink_runtime.h`, strictly adhering to pal < runtime < app layering.

### 3.1 Same-Timestamp Event Total Order ([ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md))

Sources potentially related at the same `now_us`:

| # | Event Source | Location | Total Order Resolution |
|---|---|---|---|
| 1 | JS `InterruptQueue` (GPIO Edges) | Phase 0 | **Landed**: External IRQs precede software IRQs |
| 2 | C `s_pending_queue[]` (Software IRQs) | Phase 0 Cascade | **Landed**: Executed following external IRQs |
| 3 | Pin Event Queue (`push_pin_event`) | [`02`](./02-virtual-clock.md) pull (`pulse_in`, etc.) | **Landed (Contract)**: Bypasses Phase 2; fast-forward skips ISR emission; reproducibility depends on task call order ∪ this total order |
| 4 | Scheduler `wakeup_by_time` | Phase 2 | **Landed**: Executes after Phase 0; simultaneous tasks set to READY in **ascending slot order** |

**SSOT Execution Phases**: `Phase 0 (Ext→Soft) → GC → wakeup_by_time → pick_next → Task Timeslice`.

**bit-exact Claim**: Scenarios crossing edge ISRs + timed wakeups must follow this total order + fixed registration/yield order (ADR-0013); reverse testing `test_sim_same_timestamp_*` is **Planned** (must not claim proven until green). Merging Pin Events into Phase 0.5 is a **Planned** enhancement (ADR-0053 Option B).

---

## 4. Three Pure Decision Functions

| Function | Semantics |
|---|---|
| `sim_scheduler_pick_next()` | **Round-Robin**: Scans starting at `(last_scheduled+1) mod MAX_TASKS`, picking the first READY task; updates `last_scheduled`; returns `SIM_SCHED_NO_READY` if none. Current wave has **no PRNG** (`s_prng_state` seed-initialized only, reserved for Task 7 chaotic scheduling). |
| `sim_scheduler_wakeup_by_time(now_us)` | Sets WAITING/BLOCKED tasks with `wakeup_us<=now_us` to READY, clearing `wakeup_us=0`; sets `timeout_fired=true` and `blocked_on=0` on previously BLOCKED tasks; returns count awakened. |
| `sim_scheduler_gc_zombies()` | Calls `sim_ctx_destroy` on ZOMBIE tasks from the main thread context (safe DeleteFiber on main), clears ctx to NULL, sets state to TERMINATED. |

**Known Simplifications**: Slot reuse delays initial dispatch of new tasks by one round (R7, accepted). RR may be "too fair", masking starvation—addressed by C5.3 starvation telemetry + future chaotic scheduling.

> ADR-0013 previously mentioned "xorshift32 random interleaving"; current implementation is RR. Chaotic PRNG interleaving is a Task 7 roadmap item, not current reality. `test_sim_scheduler_determinism` Case 2 will flip to NOT_EQUAL in the future as a reverse test.

---

## 5. Host vs Wasm Semantic Comparison

| Dimension | Host (Windows) | Wasm (Emscripten) |
|---|---|---|
| Fiber API | `ConvertThreadToFiber`/`CreateFiber`/`SwitchToFiber`/`DeleteFiber` | `<emscripten/fiber.h>` (Official Asyncify fiber, not manual `__asyncify_data`) |
| Business Clock | `host_sim_time_us()` (Static accumulation; `host_sim_advance_to` for testing) | `s_virtual_us` + Single Gate advance |
| WCET Clock | `host_wall_clock_us()` (QPC) | `emscripten_get_now()*1000` |
| Stack Floor | 32 KiB | 16 KiB data stack + 2 KiB Asyncify |
| Interrupt Dispatch | No-op | Phase 0 `pal_wasm_dispatch_pending_interrupts()` |
| Idle Behavior | Host time skipping | INTERACTIVE: Asyncify yield; HEADLESS: Direct C clock leap |

Platform differences are hidden behind `sim_ctx_*` (`sim_ctx_create/from_current/switch/destroy`). `sim_ctx_switch` contract v2: `from` must be non-NULL.

---

## 6. Fidelity Boundaries (ADR-0013 / ADR-0014)

1. **Non-Preemptible CPU Compute**: Tasks executing without yielding for >5ms trigger `wink_runtime_fault(callbacks, 8002)`. Note that `busy_wait_us` only advances virtual clock and consumes microsecond-level physical CPU, avoiding false 8002 triggers (`test_sim_scheduler_wcet_fault` is a reverse test).
2. **Instruction-Level Races Unmodeled**: Single virtual core cooperative execution; real dual-core instruction tearing requires physical hardware + static analysis.
3. **Wasm IRQ Latency $O(\text{tick})$**: Handled via Phase 0 polling rather than microsecond hardware vectors.
4. **`core_id` Ignored**: `pick_next` does not dispatch based on core affinity ([ADR-0014](../../../decisions/unisim/0014-sim-single-virtual-core.md)).

### 6.1 Unmodeled Bug Classes under Single Virtual Core (ADR-0014)

1. Lock-free cross-core struct write tearing;
2. Core pinning timing assumptions / `xPortGetCoreID()` branches;
3. Cross-core cache flushing and DMA coherency (`Cache_WriteBack_Addr`);
4. Inter-core ISR wakeup latency from Core X to Core Y;
5. Spinlock (`portMUX_TYPE`) vs task semaphore behavioral drift (degenerate to equivalent on single core).

These remain the responsibility of physical hardware + static analysis. SMP simulation is explicitly rejected; future SMP needs require a new ADR (original ADR number 0015).

### 6.2 Hardcoded Rules (App Side)

- Prohibited: Unyielding `while(1)` (must call `pal_os_sleep_ms` or yield);
- `pal_os_ringbuf_pop` must check `WINK_ERR_EMPTY`, prohibiting synchronous busy-waiting;
- Local variables crossing yields in Wasm stackless coroutines **must be `static`**, enforced pre-compilation by `check_pt_variables.py`.

---

## 7. `pal_os_task_delete` Semantic Boundaries (Fixup R10)

| Call | Behavior |
|---|---|
| `delete(NULL)` (Self) | Current task → ZOMBIE, path `mark_zombie(cur) → sim_ctx_switch(cur_ctx, main_ctx)`, main loop GC |
| `delete(other)` (Target un-yielded) | Target → ZOMBIE; its fiber never ran or has yielded |
| `delete(self_handle)` (Syntax is other but target is self) | Recommended to add pal branch aligning with self-deletion; currently treated as other |
| `delete(other)` with target active in main loop | **Simulation forbidden**—impossible on single virtual core (other tasks must have yielded to main); assert fail fallback |

`sim_scheduler_task_count` counts READY/WAITING/BLOCKED/ZOMBIE (ZOMBIE can still introspect its name/id/priority before GC); TERMINATED is excluded. To query "runnable tasks count", add `count_by_state(READY)` (Task 7 reserved, currently unimplemented).

---

## 8. STRICT_NONBLOCKING Compile-Time Gates (ADR-0025)

Simulation (Wasm/fiber) targets default to `-DWINK_STRICT_NONBLOCKING=1`:

- Functions marked `WINK_BLOCKING` (e.g., blocking `dal_ultrasonic_read`) are hidden in headers, failing misuses with **link-time undefined reference** (fail-fast), rather than silently running under Asyncify;
- Bringup/selftest blocking utilities reside in `runtime/selftest/`, wrapped with `#ifndef WINK_STRICT_NONBLOCKING`, leaving stubs returning `WINK_ERR_UNSUPPORTED` in strict mode;
- BAL helper classification drives pragmas: LIGHT helpers (`wink_led_blink_helper`, etc.) **must not** contain blocking regions; MAY_BLOCK helpers (`wink_sonar_helper`/`wink_servo_helper`/`wink_telemetry_helper`/`wink_oled_helper`) use file-level `WINK_INTERNAL_BLOCKING_REGION`; business callbacks and `app_loop()` ban any pragmas;
- LIGHT context assertion `WINK_ASSERT_NONBLOCKING()` provides defensive runtime enforcement.

**Why** (Discipline and layering): See [`../01-overview/04-methodology.md`](../01-overview/04-methodology.md) §4 (STRICT_NONBLOCKING compile-time gate).

**How to Do** (CMake/linker/selftest implementation): See [`./01-sandbox-and-execution.md`](./01-sandbox-and-execution.md) §5.

See details in [ADR-0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md).

---

## 9. OS Synchronization Primitives Parity Matrix (C16)

Simulation and real hardware semantics must be nailed down item by item (comparison table + unit tests) to prevent "returning different values by coincidence":

| Primitive | Must-Align Semantics | Simulation Landing (Honest) |
|---|---|---|
| Mutex | Timeout return code, reentrancy, owner check; `timeout_fired` behavior | **Landed** (`pal_osal_wasm.c` static pool + scheduler `block`/`timeout_fired`) |
| Semaphore | Take/give, ISR give, timeouts | **Landed** (Same as above) |
| Ringbuf | Full policy, empty return code, zero-copy | **Landed** (`osal/common/pal_osal_ringbuf.c`; full reject / empty `WINK_ERR_EMPTY`) |
| Queue (Message Queue) | Full policy, empty return code | **Planned** (Standalone Queue API separate from ringbuf byte stream not in this table's SSOT) |
| Contested Timeouts | **Winner** when event and timeout expire simultaneously | **Partial** (Relies on `wakeup_by_time` + total order; cross-source total order see §3.1 Planned) |
| Task Notifications / Event Groups | Auto-clearing bits, wait-multi-bit | **Planned** / Do not use unless exposed |
| Deadlock Detection | Wait-for-graph / lock ordering | **Planned** |

Priority Inversion (C5.5): Whether priority inheritance is implemented must be explicitly stated, with detection for "high-priority blocked on lock held by low-priority exceeding threshold"; baseline has **no** inheritance (**Planned**/non-goal depending on product scope).

---

## 10. Acceptance Tests

- `test_sim_scheduler`: Unit tests covering `pick_next`, `wakeup_by_time`, `block-resume`, stack clamping, and zombie GC (11 cases)
- `test_sim_scheduler_e2e`: Dual-task ring buffer producer/consumer
- `test_sim_scheduler_zombie_gc`: Self-deleted fiber release
- `test_sim_scheduler_wcet_fault`: CPU busy-waits triggering fault 8002; `busy_wait_us` avoids false triggers
- `test_sim_scheduler_determinism`: Same seed consistency; RR semantics locked
- `test_sim_scheduler_stack_clamp`: Host fiber stack floor clamping
- `test_sim_scheduler_headless_jump`: HEADLESS virtual clock fast jumping (ADR-0042)
- `test_single_task_semantic_regression`: Avoidance car business fields aligned to baseline

## 11. Future Evolution

- **Task 7 Chaotic Scheduling**: `pick_next` introduces PRNG interleaving + `fairness_bound` to stimulate race conditions (C3.1); determinism secured by seed.
- **Preemptive Simulation**: If implemented, still requires seed-driven preemption decisions to preserve determinism; high performance/complexity cost.
- **SMP**: Explicitly rejected, requires new ADR.
- FOC fast loop is a "virtual time deterministic stepping" scheduler consumer (ADR-0047), see [09-timer-and-pwm-semantics.md](./09-timer-and-pwm-semantics.md).
