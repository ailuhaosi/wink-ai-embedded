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

---

## Bottom-Up Ordering

New mechanisms must insert at their appropriate architectural layer:

```text
1 Execution Environment / Sandbox  → 01-sandbox-and-execution
2 Timebase                         → 02-virtual-clock
3 Concurrency & Scheduling         → 03-scheduler-and-concurrency
4 Interrupts                       → 04-interrupt-model
5 Faults & Memory                  → 05-memory-and-faults
6 Physical Degradation Injection   → 06-physical-degradation
7 Peripheral Configuration Plane   → 07-peripheral-registry
8 Peripheral Data Plane (Channels) → 08-channel-routing
9 Hardware Timer Semantics         → 09-timer-and-pwm-semantics
10 Host ABI                        → 10-wasm-js-bridge-abi
11 Observability / Lifecycle       → 11-accuracy-observation-lifecycle
12 Closed-Loop Co-Simulation       → 12-bidirectional-high-fidelity-closed-loop
```

---

## Directory Index

| File | Primary Supporting Axis | Wave | Migrated From 2.0 |
|---|---|---|---|
| [01-sandbox-and-execution.md](./01-sandbox-and-execution.md) | Cross-cutting; STRICT implementation | **2A** | `02` |
| [02-virtual-clock.md](./02-virtual-clock.md) | B primary | **2A** | `03` |
| [03-scheduler-and-concurrency.md](./03-scheduler-and-concurrency.md) | E primary | **2A** | `04` |
| [04-interrupt-model.md](./04-interrupt-model.md) | D primary | **2A** | `05` |
| [05-memory-and-faults.md](./05-memory-and-faults.md) | F primary | **2B** | `06` |
| [06-physical-degradation.md](./06-physical-degradation.md) | A/F secondary | **2B** | `07` |
| [07-peripheral-registry.md](./07-peripheral-registry.md) | A secondary | **2C** | `08` |
| [08-channel-routing.md](./08-channel-routing.md) | A primary | **2C** | `09` (Timer stripped) |
| [09-timer-and-pwm-semantics.md](./09-timer-and-pwm-semantics.md) | **C primary** | **2C** | `09` §1.4/§5.3 |
| [10-wasm-js-bridge-abi.md](./10-wasm-js-bridge-abi.md) | Cross-cutting ABI | **2D** | `10` |
| [11-accuracy-observation-lifecycle.md](./11-accuracy-observation-lifecycle.md) | F secondary | **2D** | `15` |
| [12-bidirectional-high-fidelity-closed-loop.md](./12-bidirectional-high-fidelity-closed-loop.md) | A/B/E primary | **2D** | New |

---

## SSOT Rules

- **Implementation details reside strictly in this directory**. `03-axes/*` and `01-overview/*` must not paste algorithms or ABI tables.
- **Channels vs Timers**: `08` = Data source routing; `09` = Timer/PWM hardware behavioral models.
- Frontmatter must populate: **Landed / Associated Code / Last Audit / Governing ADRs**.
