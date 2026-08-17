# Axis D — Interrupt Model

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/D-interrupt-model.md
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

When do ISRs execute? Can they nest or preempt?

## 2. Primary Mechanism

- [`../02-mechanisms/04-interrupt-model.md`](../02-mechanisms/04-interrupt-model.md) — Poll queue, critical section unlock replay, verifiable boundaries.

## 3. Secondary Mechanisms

- Asyncify and single-threaded host limitations → [`../02-mechanisms/01-sandbox-and-execution.md`](../02-mechanisms/01-sandbox-and-execution.md)
- Phase 0 IRQ draining → [`../02-mechanisms/03-scheduler-and-concurrency.md`](../02-mechanisms/03-scheduler-and-concurrency.md)

## 4. Typical Bounds & Constraints

1. **Model Upper Bound**: Cooperative polling ≠ hardware NVIC preemption; cannot verify priority nesting or sub-microsecond IRQ preemption.
2. **Latency Magnitude**: Worst-case dispatch latency is on the order of one scheduling tick (~10ms).
3. **Critical Sections**: Nest-count and unlock replay emulate IRQ masking semantics safely.
