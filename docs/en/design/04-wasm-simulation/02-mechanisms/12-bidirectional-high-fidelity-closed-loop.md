# Bidirectional High-Fidelity Closed-Loop Simulation Mechanism

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/12-bidirectional-high-fidelity-closed-loop.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Step-Lock Pipeline, Bidirectional Causality, Golden Trace Parity) |
| Supporting Axis | **A/B/E (primary)** |

---

## 1. Closed-Loop Execution Flow

```text
C Firmware Controller (App/BAL/DAL)
       │ Outputs control actions (PWM duty / Pin toggle)
       ▼
PAL Wasm Layer (js_pal_*)
       │ Posts to simulation event bus
       ▼
UniSim Plugin (Mechanical & physical updates over Δt)
       │ Calculates sensor responses (Distance, encoder pulses)
       ▼
PinArbiter / InterruptQueue (Injected back into C firmware)
```
