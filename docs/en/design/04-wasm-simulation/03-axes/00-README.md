# Ⅱb Fidelity Axes Thin Index (axes)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/00-README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Layer | Ⅱb Axes A~F Fidelity Perspective |
| Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| Responsibility | Documents what each axis guarantees, its upper bounds, and pointers; **prohibits** becoming a duplicate implementation SSOT |

---

## Why a Dedicated Directory

Product narratives assert fidelity along Axes A~F, while engineering evolves along subsystem mechanisms. Partitioning ensures:
- Updating clock algorithms $\rightarrow$ Modify `02-mechanisms/02-virtual-clock.md`;
- Updating "Axis B commitments" $\rightarrow$ Modify `B-timebase.md` + overview scopes.

---

## Axis $\leftrightarrow$ Mechanism Cardinality

| Relationship | Cardinality | Description |
|---|---|---|
| Axis $\rightarrow$ Primary Mechanism | **Exactly 1** | Every axis has exactly one primary home |
| Mechanism $\rightarrow$ Axis as Primary | **0 or 1** | Mechanisms never serve as primary for two axes |
| Axis $\rightarrow$ Secondary Mechanism | 0..N | Optional supporting mechanisms |
| Cross-Cutting Mechanism | Primary = 0 | e.g., `01-sandbox`, `10-bridge` |

---

## Asymmetry with Overview

| Location | Contents | Exclusions |
|---|---|---|
| [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) | Letter **definitions** + comparison table (Abbreviated upper bounds) | Implementation algorithms, expanded upper bounds |
| `03-axes/X-*.md` | Echo of core questions; **expanded** upper bounds; primary/secondary pointers; C scenarios | **Altering definitions**, code blocks, status emojis, maturity tags |

---

## Fixed Template per Axis Page

1. **Question Addressed**
2. **Primary Mechanism** (Matches table below)
3. **Secondary Mechanisms** (Optional Ⅱa mechanisms or binding ADRs)
4. **Typical Upper Bounds / Non-Verifiable Scope** (Expanded)
5. **Associated C Scenarios** ($\rightarrow$ Assurance spec)

---

## Primary Home Mapping

| File | Axis | Primary Home |
|---|---|---|
| [A-peripheral-source.md](./A-peripheral-source.md) | A | `08-channel-routing` |
| [B-timebase.md](./B-timebase.md) | B | `02-virtual-clock` |
| [C-timer-semantics.md](./C-timer-semantics.md) | C | `09-timer-and-pwm-semantics` |
| [D-interrupt-model.md](./D-interrupt-model.md) | D | `04-interrupt-model` |
| [E-scheduler-concurrency.md](./E-scheduler-concurrency.md) | E | `03-scheduler-and-concurrency` |
| [F-fault-and-observation.md](./F-fault-and-observation.md) | F | `05-memory-and-faults` |

Axis letter definitions reside in [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md).
