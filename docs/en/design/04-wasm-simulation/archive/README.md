# WebAssembly Simulation & Frontend Runtime Engine (UniSim)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

> **⚠️ Archived (2026-08-02)**: This directory contains the historical UniSim **1.0** version, which has been superseded by [**UniSim 3.0 (Active SSOT)**](../00-README.md). These documents are retained for historical reference only.

This directory documents the historical architecture and specifications for the **Wink-AI** frontend WebAssembly simulation sandbox and virtual peripheral runtime (UniSim 1.0).

---

## Multi-Axis Fidelity Overview (Orthogonal Dimensions)

| Axis | Question Addressed | Primary Mechanism | Primary Document | Typical Upper Bound |
|---|---|---|---|---|
| **A. Peripheral Source** | Where sensor/actuator data originates | 4 Channels + PWM: Pin / Bus / Analog / Buffer; PinArbiter, Plugins | [03](./03-multi-channel-sim-routing.md), [02](./02-virtual-peripheral-registry.md) | Unmodeled analog frontends; pending channels |
| **B. Timebase** | Reference clock for delays / timeouts / pulses | `s_virtual_us` SSOT; single-gate progression | [05](./05-simulation-consistency-and-fidelity-spec.md), [06](./06-physical-degradation-engine.md) | Decoupled from host wallclocks |
| **C. Timer Semantics** | HW timer / PWM periods / capture | PAL timers, soft-stepping; mutual exclusion | [05](./05-simulation-consistency-and-fidelity-spec.md), [ADR-0047](../../../decisions/core/0047-foc-isr-layering-and-pal-hwtimer.md) | No 10kHz+ hard ISRs; FOC behavioral only |
| **D. Interrupt Model** | When ISRs execute; preemption / nesting | Asyncify cooperative insertion, IRQ polling queue | [01](./01-wasm-sandbox-lifecycle.md), [05](./05-simulation-consistency-and-fidelity-spec.md) | Non-verifiable priority nesting |
| **E. Scheduler & Concurrency** | Multitasking, blocking, critical sections | Cooperative single virtual-core scheduler | [07](./07-scheduler-model.md), [05](./05-simulation-consistency-and-fidelity-spec.md) | SMP / true preemption requires hardware |
| **F. Fault & Observability** | OOM, WDT, race conditions, traces | Fault latches, lint gates, scenario checklists | [05](./05-simulation-consistency-and-fidelity-spec.md), [08](./08-simulation-consistency-checklist.md), [ADR-0045](../../../decisions/unisim/0045-simulation-memory-quota-and-fault-policy.md) | Checklist 🚫 items mandate hardware/HIL |

---

## Module Design Documents

*   **[01-wasm-sandbox-lifecycle.md](./01-wasm-sandbox-lifecycle.md)** — Wasm Sandbox Lifecycle & Asyncify
*   **[02-virtual-peripheral-registry.md](./02-virtual-peripheral-registry.md)** — Virtual Circuit, DeviceTree & SchemaForm
*   **[03-multi-channel-sim-routing.md](./03-multi-channel-sim-routing.md)** — 4-Channel Peripheral Routing & Selection
*   **[04-velxio-migration-analysis.md](./04-velxio-migration-analysis.md)** — Velxio Comparison & Migration Analysis
*   **[05-simulation-consistency-and-fidelity-spec.md](./05-simulation-consistency-and-fidelity-spec.md)** — Simulation Consistency & Fidelity Specification SSOT
*   **[06-physical-degradation-engine.md](./06-physical-degradation-engine.md)** — Physical Degradation & Fault Injection Engine
*   **[07-scheduler-model.md](./07-scheduler-model.md)** — Cooperative Scheduler Model
*   **[08-simulation-consistency-checklist.md](./08-simulation-consistency-checklist.md)** — Scenario Testability Checklist SSOT

---

## Known Behavioral Boundaries

Wink-AI simulation delivers **behavioral (causal) fidelity**, guaranteeing causal ordering of business logic without promising cycle-accurate hardware timing ([ADR-0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md)).

---

## Core Architecture Diagram

```text
 ┌────────────────────────────────────────────────────────┐
 │     Vue 3 Main Thread (Canvas / Hub / ProductWorld)    │  Axis A Injection & Observation
 └───────────────────────────▲────────────────────────────┘
                             │ postMessage
                             ▼
 ┌────────────────────────────────────────────────────────┐
 │             Web Worker (SimWorker + Plugins)           │
 │  PinArbiter / I2C·SPI·UART / VirtualClock / PluginHost │  Axes A/B
 │  ┌───────────────────────┐    ┌─────────────────────┐  │
 │  │    Wasm-Core (C OS)   ├───►│   Wasm JS Bridge    │  │
 │  │ App/BAL/DAL + PAL API │    │ Asyncify · js_pal_* │  │  Axes D/E
 │  │ OSAL Cooperative Sched│    │ IRQ queue poll      │  │
 │  └───────────────────────┘    └─────────────────────┘  │
 └────────────────────────────────────────────────────────┘
```
