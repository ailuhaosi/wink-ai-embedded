# Simulation Multi-Axis Overview (Orthogonal Dimensions A~F)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/01-overview/02-axes-af.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / overview) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| SSOT Role | **Authoritative canonical definition point for letters A~F** |

Simulation capabilities are evaluated across the following orthogonal axes:

| Axis | Questions Answered | Primary Mechanism | Primary Doc | Typical Boundary / Upper Bound |
|---|---|---|---|---|
| **A. Peripheral Source** | Where does sensor/actuator/bus data come from? | 5 Channels (Pin / Bus / Analog / Buffer / PWM 1b); PinArbiter | [`08-channel-routing.md`](../02-mechanisms/08-channel-routing.md) | No analog SPICE simulation |
| **B. Timebase** | Who acts as the clock for delays, timeouts, and pulse widths? | `s_virtual_us` SSOT; Single Gate; No dual-stepping | [`02-virtual-clock.md`](../02-mechanisms/02-virtual-clock.md) | Non-wallclock real-time |
| **C. Timer Semantics** | HW timers, PWM periods, and capture | PAL timer approximation; Mutex gate | [`09-timer-and-pwm-semantics.md`](../02-mechanisms/09-timer-and-pwm-semantics.md) | No >10kHz hard ISR |
| **D. Interrupt Model** | When do ISRs run? Can they nest or preempt? | Asyncify cooperative yield; IRQ Queue Poll | [`04-interrupt-model.md`](../02-mechanisms/04-interrupt-model.md) | **Cannot** verify priority nesting |
| **E. Scheduler & Concurrency** | Multi-tasking, blocking, critical sections | Cooperative single virtual-core scheduler | [`03-scheduler-and-concurrency.md`](../02-mechanisms/03-scheduler-and-concurrency.md) | SMP / True preemption → Hardware |
| **F. Faults & Observation** | OOM, WDT, Race conditions, Tracing | Fault strategies, lint gates, Golden Trace | [`05-memory-and-faults.md`](../02-mechanisms/05-memory-and-faults.md) | HIL mandatory for marked items |

```text
Firmware C (Single-source dual-target compilation)
        │
        ├─ A Peripheral Source  ← 08 Channel Routing / 07 UniSim Plugin
        ├─ B/C Time & Timers    ← 02 VirtualClock / 09 Timer Semantics
        ├─ D Interrupt Model    ← 04 Asyncify + IRQ Poll
        ├─ E Scheduler Model    ← 03 Cooperative Scheduler / Virtual Core
        └─ F Faults & Gates     ← 05/06 + Assurance / Lint / 11 Observability
                ↓
         Physical MCU / HIL Hardware
```
