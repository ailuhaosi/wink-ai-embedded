# Axis E — Scheduler & Concurrency

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/E-scheduler-concurrency.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Tier | Ⅱb Thin Index |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Canonical Definition | [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) |

## 1. Questions Answered

Multi-tasking, blocking, critical sections, and multi-core execution.

## 2. Primary Mechanism

- [`../02-mechanisms/03-scheduler-and-concurrency.md`](../02-mechanisms/03-scheduler-and-concurrency.md) — Cooperative single virtual-core scheduler, synchronization primitives, and `STRICT_NONBLOCKING`.

## 3. Typical Bounds & Constraints

1. **Model Upper Bound**: Cooperative single virtual core; task switching only occurs at explicit yield points (no true preemption).
2. **Multi-core**: Multi-core SMP concurrency and cache consistency require physical hardware validation.
3. **Instruction-Level Races**: Microscopic interleaving between arbitrary CPU instructions cannot be verified in this model.
