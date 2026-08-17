# Interrupt Model: Polling Queue, Critical Sections & Non-Verifiable Boundaries

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/04-interrupt-model.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Landed** (Polling queue / Phase 0 & unlock dispatch / Dual FIFO); Queue overflow fail-loud is **Partial**; Priority nesting is non-verifiable |
| Supporting Axis | **D (primary)** |
| Associated Code | `wink-micro-os/targets/wasm/pal_irq_wasm.c`, `wink-micro-os/targets/wasm/wasm_bridge.h`, `wink-micro-os/targets/wasm/pal_wasm_internal.h`, `@wink-ai/unisim` (InterruptQueue) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0002, 0003, 0013, 0018 (PAL IRQ narrowing) |
| Migrated From | `04-wasm-simulation-2.0/05-interrupt-model.md` |

> This document defines when ISRs run in Wasm, why true preemption is unmodeled, how critical sections delay dispatch, and queue overflow behaviors.

---

## 1. Execution Model: Cooperative Polling vs Preemption

Physical microcontrollers interrupt arbitrary CPU instructions and execute nested ISRs based on priority vectors. In a single-threaded Wasm sandbox with Asyncify, arbitrary instruction interception is unachievable. UniSim adopts a **Polling Model**:

- The JavaScript host **enqueues pending edges** upon detecting GPIO events, never invoking Wasm reentrantly;
- The C runtime polls and drains pending ISRs at designated dispatch points;
- ISR latency is bounded to **$O(\text{1 scheduler tick / yield point})$** ($\approx 10\text{ms}$), not microsecond real-time; priority nesting is unmodeled.

Dispatch Points:
1. **Scheduler Phase 0**: Executed at the beginning of each scheduler tick in the main context (`pal_wasm_dispatch_pending_interrupts()`);
2. **Critical Section Unlock**: Executed upon outermost unlock (`pal_irq_restore()` when nest count drops $1 \rightarrow 0$), matching physical MCU behavior where pending interrupts fire immediately upon reenabling.

---

## 2. Dual IRQ Sources & Unified Drain Order

`pal_irq_wasm.c` manages two FIFO queues, draining in fixed order (**External IRQs $\rightarrow$ Software IRQs**):

```text
Scheduler Phase 0 / pal_irq_restore Outermost Unlock
        │
        ▼
pal_wasm_dispatch_pending_interrupts()
        ├─ Holds IRQ Lock? → Return immediately (Deferred to unlock)
        ├─ while js_pal_poll_interrupt(&cb,&arg):   // Drain JS InterruptQueue (GPIO edges)
        │     ISR(callback_index → Function pointer, arg)
        └─ pal_wasm_dispatch_pending_irqs()         // Cascaded drain of C software IRQ FIFO
              while sw_dequeue(&irq_num):
                if handler != NULL: ISR(handler, arg)
```

| IRQ Source | Ingestion | Queue | Overflow Policy |
|---|---|---|---|
| GPIO Edges (PinArbiter) | JS `InterruptQueue` (FIFO) | JS Host | **Drop-Newest** (Preserves causal order of historical pulses) |
| `pal_irq_set_pending()` Software IRQ | C `s_pending_queue[]` (Ring, `WASM_MAX_PENDING=64`) | C Kernel | **Drop-Oldest** (Latest pending represents current service state) |

- If an IRQ handler was set to NULL via `pal_irq_disable`, dequeued entries are silently dropped.
- `s_pending_overflow_count` accumulates C queue overflow instances for diagnostic sizing.
- ISR execution wraps in `pal_os_set_sim_isr_context(true/false)` to trap illegal blocking calls.

---

## 3. Wasm Table Routing & Registration

Physical MCUs route interrupts via vector tables containing function pointers. Wasm sandboxes enforce memory safety by routing indirect function calls via Wasm Table indices:

- `pal_gpio_enable_interrupt_ex(pin, intr_type, prio, callback, arg)` registers `(uint32_t)(uintptr_t)callback` and `arg_ptr` with JS via `js_pal_register_interrupt`;
- `js_pal_poll_interrupt` pops entries from JS FIFO, and C resolves indices back to `pal_gpio_isr_t` function calls;
- `pal_gpio_disable_interrupt` $\rightarrow$ `js_pal_deregister_interrupt`.

Safety Constraints:
- `callback_index` represents an opaque Wasm table index;
- `pal_irq_wasm.c` asserts `sizeof(void*) == 4`;
- Maximum pin count `WASM_MAX_GPIO_PIN = 50`; logical IRQ table `WASM_MAX_IRQ = 32`.

---

## 4. Critical Sections & Nesting Counters

A unified IRQ lock counter `s_irq_lock_nest_count` serializes interrupts:

```c
uint32_t pal_irq_save(void) {
    uint32_t was_enabled = (nest == 0) ? 1 : 0;
    nest++;
    return was_enabled;
}
void pal_irq_restore(uint32_t mask) {
    if (nest > 0) {
        nest--;
        if (nest == 0 && mask) {
            pal_wasm_dispatch_pending_interrupts();  // Outermost unlock dispatch
        }
    }
}
```

---

## 5. FromISR / ISR Safety Rules (C4.4, C20.1)

- Runtime flags `pal_os_set_sim_isr_context` trap blocking or lock-acquiring API calls inside ISRs;
- ISRs must never invoke yielding DAL functions (e.g., synchronous sensor reads) to avoid reentrancy panics;
- Enforced via: **A** Lint rules (ISR-safe whitelist) + **C** Runtime trap on illegal API invocation $\rightarrow$ Fault.

---

## 6. Queue Capacity & Fail-Loud Protections

- JS queue size is configured by `PAL_WASM_INTERRUPT_QUEUE_SIZE` (default **16**, `pal_wasm_internal.h`);
- **Rule C4.5**: Queue overflows must never fail silently. GPIO overflows must log warnings or trigger faults; C software IRQs drop oldest and increment `overflow_count`.

Cross-Repository Audit Checklist:
1. `_trigger_wasm_interrupt` push symbols permanently removed;
2. GPIO events during sleep only enqueue;
3. FIFO drains between wake and subsequent delay;
4. Zero `invalid Asyncify state` / stack corruption panics;
5. 1000 ticks $\times$ 4 interrupts match exact ISR invocation counts;
6. Visible overflow warnings.

---

## 7. Symmetry with Physical Hardware (ADR-0002)

| Dimension | Physical ESP32 | Wasm Simulation |
|---|---|---|
| Deferred Handling | ISR posts to FreeRTOS Queue, Bottom-Half task consumes | JS pushes pending, C drains at tick/yield boundaries |
| Dispatch Moment | Immediate upon interrupt exit / unmasking | Phase 0 / Outermost `irq_restore` unlock |
| Priorities | NVIC priority nesting | Single-level, non-nested |
| Critical Sections | Global interrupt disable | Nesting counter + deferred dispatch |

---

## 8. Non-Verifiable Boundaries

- ❌ Priority nesting and high-priority ISR preemption (C4.3);
- ❌ Arbitrary instruction-level interruption;
- ❌ **Microsecond-level interrupt latency**: Default tick $\approx 10\text{ms}$ (`WINK_RUNTIME_TICK_MS`);
- ❌ High-baud asynchronous UART RX (115200 baud $\approx 87\mu\text{s/byte} \ll 10\text{ms}$ tick) under `timing` mode;
- 🟡 Single-level interrupt deferral outside critical sections is supported;
- 🟡 Same-timestamp total order with `wakeup_by_time` / Pin Events: [ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md).
