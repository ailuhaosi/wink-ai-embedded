# Cooperative Scheduler & Concurrency Model

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/03-scheduler-and-concurrency.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Cooperative Scheduler, Fibers, WCET Guard, STRICT_NONBLOCKING) |
| Supporting Axis | **E (primary)** (Scheduler & Concurrency) |

---

## 1. Scheduling Architecture

- **Single Virtual Core**: Tasks run cooperatively on a single virtual core, yielding at explicit `pal_os_delay()` calls.
- **WCET Guard**: Execution exceeding 5ms triggers a WCET fault to prevent lockups.
- **STRICT_NONBLOCKING Gate**: Hides legacy blocking APIs during cooperative compilation builds.
