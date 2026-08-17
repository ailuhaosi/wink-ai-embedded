# Ⅱa Engine Mechanisms (mechanisms)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/00-README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Layer | Ⅱa Implementation SSOT |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| Responsibility | Documents subsystem implementation ("how it works"); frontmatter records landing maturity (Vocabulary from root [00-README §3.2](../00-README.md)) |
| Last Audit | 2026-08-02 (Waves 2A–2D) |

## Ordering Principles (Bottom-Up)

New mechanisms must be inserted according to the following hierarchy; unprincipled append-only is **forbidden**:

```text
1 Execution Environment / Sandbox  → 01-sandbox-and-execution     ✅ Wave 2A
2 Timebase                         → 02-virtual-clock               ✅ Wave 2A
3 Concurrency & Scheduling         → 03-scheduler-and-concurrency   ✅ Wave 2A
4 Interrupts                       → 04-interrupt-model             ✅ Wave 2A
5 Faults & Memory                  → 05-memory-and-faults           ✅ Wave 2B
6 Physical Degradation Injection   → 06-physical-degradation        ✅ Wave 2B
7 Peripheral Configuration Plane   → 07-peripheral-registry         ✅ Wave 2C
8 Peripheral Data Plane (Channels) → 08-channel-routing             ✅ Wave 2C
9 Hardware Timer Semantics         → 09-timer-and-pwm-semantics     ✅ Wave 2C (Atomic split with 08)
10 Host ABI                        → 10-wasm-js-bridge-abi          ✅ Wave 2D
11 Observability / Lifecycle       → 11-accuracy-observation-lifecycle ✅ Wave 2D
```

## Wave 2 Staging (Why Not Write All at Once)

| Sub-wave | Files | ~Source Lines | Reason |
|---|---|---:|---|
| **2A** | 01–04 | ~395 | Execution backbone; closes STRICT ↔ methodology; no 08/09 split risk |
| **2B** | 05–06 | ~223 | Fault / physical degradation, relatively independent |
| **2C** | 07–09 | ~320 | **Highest risk**: Atomic split of channels vs timer semantics |
| **2D** | 10–11 | ~245 | ABI + Accuracy SSOT, depends on symbol surface of prior batches |

Migrating ~1182 lines in a single pass would conceal 08/09 double-writing and path discrepancies; hence the staged approach above.

## Files in This Directory

| File | Primary Supporting Axis | Wave | Migrated From 2.0 |
|---|---|---|---|
| [01-sandbox-and-execution.md](./01-sandbox-and-execution.md) | Cross-cutting; STRICT "how to do" | **2A ✅** | `02` |
| [02-virtual-clock.md](./02-virtual-clock.md) | B primary | **2A ✅** | `03` |
| [03-scheduler-and-concurrency.md](./03-scheduler-and-concurrency.md) | E primary | **2A ✅** | `04` |
| [04-interrupt-model.md](./04-interrupt-model.md) | D primary | **2A ✅** | `05` |
| [05-memory-and-faults.md](./05-memory-and-faults.md) | F primary | **2B ✅** | `06` |
| [06-physical-degradation.md](./06-physical-degradation.md) | A/F secondary | **2B ✅** | `07` |
| [07-peripheral-registry.md](./07-peripheral-registry.md) | A secondary | **2C ✅** | `08` |
| [08-channel-routing.md](./08-channel-routing.md) | A primary | **2C ✅** | `09` (Timer stripped) |
| [09-timer-and-pwm-semantics.md](./09-timer-and-pwm-semantics.md) | **C primary** | **2C ✅** | `09` §1.4/§5.3 |
| [10-wasm-js-bridge-abi.md](./10-wasm-js-bridge-abi.md) | Cross-cutting ABI | **2D ✅** | `10` |
| [11-accuracy-observation-lifecycle.md](./11-accuracy-observation-lifecycle.md) | F secondary | **2D ✅** | `15` |
| [12-bidirectional-high-fidelity-closed-loop.md](./12-bidirectional-high-fidelity-closed-loop.md) | A/B/E primary | **2D ✅** | New |

## SSOT

- **Implementation body text resides strictly in this directory**. `03-axes/*` and `01-overview/*` must not paste algorithms, state machines, or ABI tables.
- **Channels vs Timers**: `08` = Where data comes from; `09` = How timer/PWM hardware behaves (Wave 2C atomic split).
- Mandatory header fields: **Landed / Associated Code / Last Audit / Governing ADRs** (see root [00 §4](../00-README.md)).
- UniSim paths uniformly use `@wink-ai/unisim` module-level descriptions, aligning with SDK exported components and ABI contracts to avoid hardcoding internal workspace paths across packages.
- **Review Closure (Documentation patches + ADR proposals)**: [2026-08-02 mechanisms review closure](../../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md) (Same-timestamp total order / UART RX / Floating-point, etc.).
