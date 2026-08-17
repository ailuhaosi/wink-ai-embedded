# Asynchronous Interrupt Queue & Polling Model

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/04-interrupt-model.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (IRQ FIFO, Polling Queue, Critical section replay) |
| Supporting Axis | **D (primary)** (Interrupt Model) |

---

## 1. Mechanism Description

Because WebAssembly cannot pierce arbitrary CPU instructions asynchronously, UniSim implements a **Phase 0 IRQ Polling Queue**:
1. External pin edge changes are pushed into an IRQ FIFO.
2. At the start of each scheduling tick (Phase 0), pending IRQs are dispatched to ISRs.
3. Critical sections mask dispatches and replay queued interrupts upon exit.
