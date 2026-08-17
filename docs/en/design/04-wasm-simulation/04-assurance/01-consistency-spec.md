# Simulation Consistency Specification & Scenario Contracts

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/04-assurance/01-consistency-spec.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / assurance) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Role | C1~C25 Scenario 5-field contracts + verification oracles |

---

## 1. Scenario Namespace (C1~C25)

- **C1**: Business state machine causality
- **C2**: Virtual microsecond logical timing
- **C3**: Shared-state race conditions
- **C4**: Critical sections & interrupt nesting
- **C5**: Blocking tasks & watchdog timeouts
- **C6**: Heap quota & memory safety
- **C7**: Bus protocol frames & CRC
- **C10**: Fast-loop timers & FOC
- **C14**: Co-simulation step-locking
- **C15**: Wasm↔Host boundary safety
