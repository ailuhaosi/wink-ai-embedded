# Axis F — Faults & Observability

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/F-fault-and-observation.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Tier | Ⅱb Thin Index |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Canonical Definition | [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) (Do not rephrase definition) |

## 1. Questions Answered

OOM, Watchdog, Race Conditions, Golden Trace.

## 2. Primary Mechanism

- [`../02-mechanisms/05-memory-and-faults.md`](../02-mechanisms/05-memory-and-faults.md) — Heap quotas, fault latching, safe-off handlers, sanitizers.

## 3. Secondary Mechanisms

- Physical degradation & fault injection → [`../02-mechanisms/06-physical-degradation.md`](../02-mechanisms/06-physical-degradation.md)
- Accuracy Mode, observation planes, lifecycle evidence → [`../02-mechanisms/11-accuracy-observation-lifecycle.md`](../02-mechanisms/11-accuracy-observation-lifecycle.md)

## 4. Typical Bounds & Constraints

1. **Governance Upper Bound**: For checklist scenarios marked as Physical/HIL exclusive, simulation pass cannot serve as production release approval.
2. **Quota & OOM**: Fixed heap ceiling is a design contract.
3. **Observation Tiers**: `behavioral`, `timing`, and `cycle` modes carry different evidence weights.
