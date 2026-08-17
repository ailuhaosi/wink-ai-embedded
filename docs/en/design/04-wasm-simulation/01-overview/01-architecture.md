# Simulation Architecture & Co-Simulation Model

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/01-overview/01-architecture.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / overview) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Architecture overview & codebase map) |
| Related ADRs | [0002](../../../decisions/unisim/0002-dual-target-compilation.md), [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md), [0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md) |

---

## 1. Layered Architecture Overview

```text
┌────────────────────────────────────────────────────────────┐
│      Vue 3 Main Thread (Canvas / ControlHub / 3D World)    │  ← Axis A Injection & Observability
└───────────────────────────────▲────────────────────────────┘
                                │ postMessage
                                ▼
┌────────────────────────────────────────────────────────────┐
│             Web Worker (SimWorker + Plugins)               │
│  PinArbiter / I2C·SPI·UART Bus / VirtualClock / Fault      │  ← Axis A/B/F
│  ┌──────────────────────┐   ┌──────────────────────────┐   │
│  │   Wasm-Core (C OS)   │──►│   Wasm JS Bridge         │   │
│  │ App/BAL/DAL + PAL API│   │ Asyncify · js_pal_*      │   │  ← Axis D/E
│  │ OSAL Scheduler       │   │ InterruptQueue (Poll)    │   │
│  └──────────────────────┘   └──────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

Critical Boundaries:
- **App / BAL / DAL are 100% single-source dual-target C code**, compiled identically to `wasm32` and `xtensa` (ESP32).
- **PAL is the sole legitimate bypass sink point**. Physical quantity sources (pin levels, pulse widths, bus transaction bytes, raw ADC values) are substituted in the PAL Wasm implementation; DAL maintains zero simulation branches.
- **Zero business physics in kernel**. Kinematic formulas and sensor degradation live purely in TypeScript simulation plugins.
