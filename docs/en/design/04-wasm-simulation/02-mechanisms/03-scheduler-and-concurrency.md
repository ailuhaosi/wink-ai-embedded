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
| **Landed** | **Landed** (Cooperative RR scheduling / Fibers / WCET / HEADLESS jumps); Chaotic PRNG interleaving is **Planned**; SMP is **Planned** (Requires new ADR) |
| Supporting Axis | **E (primary)**; **D (secondary)** — Phase 0 / tick-driven Poll & total order |
| Associated Code | `wink-micro-os/targets/common/{include,src}/wink_sim_scheduler.*`, `wink-micro-os/targets/common/include/sim_ctx.h`, `wink-micro-os/osal/{wasm,host}/pal_osal_*.c` |
| Last Audit | 2026-08-02 |
| Governing ADRs | [0007](../../../decisions/core/0007-cooperative-loop-execution-model.md), [0012](../../../decisions/core/0012-contract-honesty-over-silent-degradation.md), [0013](../../../decisions/unisim/0013-sim-cooperative-scheduler.md), [0014](../../../decisions/unisim/0014-sim-single-virtual-core.md), [0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md), [0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md) |
| Migrated From | `04-wasm-simulation-2.0/04-scheduler-and-concurrency.md` |

> This document defines multi-tasking across single Wasm stacks, task state machines, determinism, WCET guards, synchronization semantics, SMP boundaries, and STRICT_NONBLOCKING gates.

---

## 1. Objectives & Execution Model

Replaces synchronous degenerate task creation with a **deterministic cooperative scheduler** shared across host and Wasm targets:
1. Multi-task concurrency (`while(1){sleep;}` + ring buffer producer/consumer);
2. Bit-exact determinism (Identical registration order + yield patterns $\rightarrow$ 100% reproducible execution);
3. Zero deployment friction (Single-threaded Wasm, avoiding SharedArrayBuffer / COOP / COEP requirements);
4. App-level API parity with ESP32 FreeRTOS (`pal_os_task_create` / `pal_os_sleep_ms` / `pal_os_ringbuf`).

**Core Trade-off**: Context switches occur exclusively at explicit yield points (`pal_os_sleep_ms`, `pal_os_mutex_lock`). Pure CPU compute sequences are non-preemptible.

---

## 2. Task State Machine

```text
INVALID → READY → WAITING/BLOCKED → READY → ZOMBIE → TERMINATED → (Slot Reuse) READY
```

| State | Semantics | Writer |
|---|---|---|
| `INVALID` | Slot unallocated (memset 0) | `sim_scheduler_reset` |
| `READY` | Runnable; eligible for selection | register / wakeup_by_time / resume |
| `WAITING` | Timed sleep (`sleep_ms`, `wakeup_us>0`) | `yield_timed` |
| `BLOCKED` | Blocked on mutex/queue/semaphore; `timeout_fired` allows TIMEOUT return | `block` |
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
    bool     timeout_fired;     /* Cleared on resume; evaluated by mutex_lock */
    sim_task_state_t state;
    uint32_t id;                /* Monotonically allocated */
    char     name[16];
    sim_ctx_t* ctx;             /* Target coroutine context handle */
} sim_task_t;
```

Capacity Limits:

| Constant | Value | Description |
|---|---|---|
| `WINK_SIM_MAX_TASKS` | 8 | Maximum concurrent tasks |
| `WINK_SIM_TASK_WCET_THRESHOLD_US` | 5000 (5ms) | Default WCET watchdog threshold |
| `WINK_SIM_STACK_MIN` (Wasm / Host) | 16 KiB / 32 KiB | User `stack_depth` clamped to this floor |
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
            wall_start = host_wall_clock_us()              # Physical wallclock check
            sim_ctx_switch(main_ctx, task_ctx)
            set_current(NO_READY)
            duration = wall_now - wall_start
            if duration > wcet_threshold: wink_runtime_fault(callbacks, 8002)
            if next == main_task_id: ticks_run++
```

- **Phase 0 IRQ Dispatch**: Executed on Wasm targets (no-op on host), see [04-interrupt-model](./04-interrupt-model.md).
- **HEADLESS Mode**: Bypasses Asyncify when no tasks are ready and **disables WCET 8002**.
- `callbacks` pass through to `wink_runtime_fault` to trigger `app_on_fault` ([ADR-0012](../../../decisions/core/0012-contract-honesty-over-silent-degradation.md)).

### 3.1 Same-Timestamp Event Total Order ([ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md))

| # | Event Source | Location | Total Order Resolution |
|---|---|---|---|
| 1 | JS `InterruptQueue` (GPIO Edges) | Phase 0 | **Landed**: External IRQs precede software IRQs |
| 2 | C `s_pending_queue[]` (Software IRQs) | Phase 0 Cascade | **Landed**: Executed following external IRQs |
| 3 | Pin Event Queue (`push_pin_event`) | [`02`](./02-virtual-clock.md) pull (`pulse_in`) | **Landed (Contract)**: Bypasses Phase 2; fast-forward skips ISR emission |
| 4 | Scheduler `wakeup_by_time` | Phase 2 | **Landed**: Executes after Phase 0; simultaneous tasks set to READY in **ascending slot order** |

**SSOT Execution Phases**: `Phase 0 (Ext→Soft) → GC → wakeup_by_time → pick_next → Task Timeslice`.

---

## 4. Pure Decision Functions

| Function | Semantics |
|---|---|
| `sim_scheduler_pick_next()` | **Round-Robin**: Scans starting at `(last_scheduled+1) mod MAX_TASKS`, picking the first READY task; updates `last_scheduled`. |
| `sim_scheduler_wakeup_by_time(now_us)` | Sets WAITING/BLOCKED tasks with `wakeup_us <= now_us` to READY; sets `timeout_fired=true` on previously BLOCKED tasks. |
| `sim_scheduler_gc_zombies()` | Calls `sim_ctx_destroy` on ZOMBIE tasks from the main thread context, freeing fibers and transitioning state to TERMINATED. |

---

## 5. Host vs Wasm Semantic Comparison

| Dimension | Host (Windows) | Wasm (Emscripten) |
|---|---|---|
| Fiber API | `ConvertThreadToFiber`/`CreateFiber`/`SwitchToFiber`/`DeleteFiber` | `<emscripten/fiber.h>` (Official Asyncify fiber) |
| Business Clock | `host_sim_time_us()` (Monotonic accumulation) | `s_virtual_us` + Single Gate |
| WCET Clock | `host_wall_clock_us()` (QPC) | `emscripten_get_now()*1000` |
| Stack Floor | 32 KiB | 16 KiB data stack + 2 KiB Asyncify |
| Interrupt Dispatch | No-op | Phase 0 `pal_wasm_dispatch_pending_interrupts()` |
| Idle Behavior | Host time skipping | INTERACTIVE: Asyncify yield; HEADLESS: Direct C clock leap |

---

## 6. Fidelity Boundaries (ADR-0013 / ADR-0014)

1. **Non-Preemptible CPU Compute**: Tasks executing without yielding for >5ms trigger `wink_runtime_fault(callbacks, 8002)`.
2. **Instruction-Level Races Unmodeled**: Instruction-level interleaving requires physical hardware and static analyzers.
3. **Wasm IRQ Latency $O(\text{tick})$**: Handled via Phase 0 polling rather than microsecond hardware vectors.
4. **`core_id` Ignored**: Scheduling ignores core pinning arguments ([ADR-0014](../../../decisions/unisim/0014-sim-single-virtual-core.md)).

### 6.1 Unmodeled Bug Classes under Single Virtual Core

1. Lock-free cross-core struct write tearing;
2. Core pinning timing assumptions (`xPortGetCoreID()`);
3. Cross-core cache flushing and DMA coherency;
4. Inter-core ISR wakeup latency;
5. Spinlock (`portMUX_TYPE`) vs semaphore behavioral drift.

---

## 7. `pal_os_task_delete` Semantic Boundaries

| Call | Behavior |
|---|---|
| `delete(NULL)` (Self) | Transitions current task to ZOMBIE $\rightarrow$ yields to `main_ctx` for main loop GC |
| `delete(other)` (Target un-yielded) | Transitions target to ZOMBIE; fiber destroyed during main GC |
| `delete(self_handle)` | Handled as self-deletion |
| `delete(other)` on Active Task | **Forbidden in simulation** (Assert failure) |

---

## 8. STRICT_NONBLOCKING Compile-Time Gates (ADR-0025)

Simulation targets default to `-DWINK_STRICT_NONBLOCKING=1`:
- Functions marked `WINK_BLOCKING` (e.g., blocking `dal_ultrasonic_read`) are hidden in headers, failing builds with **undefined reference** errors;
- Bringup/selftest utilities in `runtime/selftest/` return `WINK_ERR_UNSUPPORTED` stubs;
- LIGHT BAL helpers must not declare blocking regions;
- Runtime `WINK_ASSERT_NONBLOCKING()` provides defensive runtime enforcement.

---

## 9. OS Synchronization Primitives Parity Matrix (C16)

| Primitive | Verified Semantics | Simulation Status |
|---|---|---|
| Mutex | Timeout codes, non-recursive ownership, `timeout_fired` behavior | **Landed** (`pal_osal_wasm.c` static pool + `block`/`timeout_fired`) |
| Semaphore | Take/give, ISR give, timeouts | **Landed** |
| Ringbuf | Full/empty policies, zero-copy guarantees | **Landed** (`pal_osal_ringbuf.c`; `WINK_ERR_EMPTY`) |
| Queue | Full/empty overflow policies | **Planned** |
| Contested Timeouts | Resolving simultaneous events vs timeouts | **Partial** (Governed by `wakeup_by_time` total order) |
| Task Notifications | Auto-clearing bits, multi-bit waits | **Planned** |
| Deadlock Detection | Wait-for graph analysis | **Planned** |

---

## 10. Automated Acceptance Suites

- `test_sim_scheduler`: Unit tests covering `pick_next`, `wakeup_by_time`, `block-resume`, stack clamping, and zombie GC.
- `test_sim_scheduler_e2e`: Dual-task ring buffer producer/consumer pipeline.
- `test_sim_scheduler_wcet_fault`: CPU busy-waits triggering fault 8002.
- `test_sim_scheduler_determinism`: Validates bit-exact deterministic scheduling.
- `test_sim_scheduler_headless_jump`: HEADLESS virtual time skipping.
