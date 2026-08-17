# Memory Quotas, Fault Latching & Safe-Off Handlers

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/05-memory-and-faults.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Heap Quotas, Fault Latching, safe-off) |
| Supporting Axis | **F (primary)** (Faults & Observability) |

---

## 1. Core Mechanisms

- **Heap Quota Ceiling**: Fixed memory cap prevents OOM leaks inside the sandbox.
- **Fault Latching**: Fatal runtime exceptions lock the system state immediately.
- **Automated Safe-off**: Forces all registered actuators into safe shutdown states upon fault.
