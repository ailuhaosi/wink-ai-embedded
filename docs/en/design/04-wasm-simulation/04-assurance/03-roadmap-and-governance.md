# Evolution Roadmap, CI Tiers & Documentation Governance

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/04-assurance/03-roadmap-and-governance.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / assurance) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| SSOT Responsibility | Phase milestones, 3-Tier CI, **Mechanism Maturity Master Table**, maintenance procedures, **Code $\rightarrow$ Docs Sync**, **ADR Backport Index**, **Golden Vector Governance** |
| Associated Code | `wink-tools/wink.py`; `.github/workflows/clang-tidy.yml` |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0003, 0009, 0013, 0014, 0042, 0045, 0047, [0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md), [0054](../../../decisions/unisim/0054-sim-uart-async-rx-model-boundary.md), [0055](../../../decisions/unisim/0055-sim-fp-determinism-and-golden-policy.md) |
| Migrated From | `04-wasm-simulation-2.0/13-roadmap-and-governance.md` |

> Mechanism maturity vocabulary defined in root [`00-README.md` §3.2](../00-README.md). Document lifecycle vocabulary in root §3.1. Scenario testability resides solely in [`02-consistency-checklist.md`](./02-consistency-checklist.md).

---

## 0. Frozen Governance Directives

### 0.1 Code Modification $\rightarrow$ Mandatory Documentation Refresh
When code associated with any `02-mechanisms/*` document undergoes API signature, semantic, or ABI modifications:
1. Update the corresponding document and its **Last Audit** timestamp in the **same PR**;
2. PR Reviewers verify that ABI diffs in `wink-micro-os/osal/wasm/`, `targets/wasm/`, or `@wink-ai/unisim` accompany documentation updates.

### 0.2 Accepted ADR $\rightarrow$ Backport to Design Specs
1. Trace impacted documents via their frontmatter **Governing ADRs** field;
2. Update technical sections and frontmatter metadata;
3. Refresh **Last Audit** timestamps;
4. Update §1.1 Maturity Master Table and mechanism frontmatter "Landed" tags if maturity levels change.

---

## 1. Core Divergence Dimensions (Expanded)

| Dimension | Simulation Baseline | Physical Hardware | Escape Hazard | Primary Scenarios |
|---|---|---|---|---|
| Concurrency | Single virtual core, cooperative yields | Preemption + Dual-core | Unsynchronized shared-memory races | C3, C9, C16 |
| Interrupts | Tick / yield polling | Arbitrary preemption, nesting | Invalid writes outside critical sections | C4, C15 |
| Buses & I/O | Synchronous 0µs; drop injection | Asynchronous DMA + faults | Unhandled bus timeouts and lockups | C7, C8, C18, C19 |
| Timebase | Virtual time fast-forwarding | Continuous wallclock + ppm drift | Skipped edges, dual stepping | C2, C14, C21 |
| Host Boundary | Asyncify / JS plant models | Pure silicon | Host-side false greens | C14, C15 |
| Lifecycle | Hot-reused Web Workers | Power-on resets | Stale state masking cold-boot bugs | C13, C23 |
| Resource Topology | Implicit software sharing | Exclusive hardware blocks | Pin / timer resource conflicts | C17 |
| Memory / ABI | Large heap, relaxed alignment | Constrained SRAM, strict alignment | OOM and struct padding bugs | C6, C12, C24, C25 |

### 1.1 Mechanism Maturity Master Table

| Mechanism | Document | Overall Status | Notes / Sub-items |
|---|---|---|---|
| Layered Architecture / Code Map | [`../01-overview/01-architecture.md`](../01-overview/01-architecture.md) | Landed | Descriptive; no unlanded promises |
| Worker / Asyncify / Exec Modes | [`../02-mechanisms/01-sandbox-and-execution.md`](../02-mechanisms/01-sandbox-and-execution.md) | Landed | INTERACTIVE + HEADLESS |
| Single Gate Clock / Fast-Forward | [`../02-mechanisms/02-virtual-clock.md`](../02-mechanisms/02-virtual-clock.md) | Landed | Ultrasonic Zero-Yield path is Partial |
| Cooperative Scheduler / Fiber / WCET | [`../02-mechanisms/03-scheduler-and-concurrency.md`](../02-mechanisms/03-scheduler-and-concurrency.md) | Landed | Chaotic PRNG is Planned; SMP rejected |
| IRQ Polling / Critical Section Replay | [`../02-mechanisms/04-interrupt-model.md`](../02-mechanisms/04-interrupt-model.md) | Landed | Fail-Loud overflow warnings are Partial |
| Fault Latch / Safe-Off / SafeWrap | [`../02-mechanisms/05-memory-and-faults.md`](../02-mechanisms/05-memory-and-faults.md) | Partial | Fault/safe-off sub-items are Landed |
| Fixed Heap Quota (ADR-0045) | [`../02-mechanisms/05-memory-and-faults.md`](../02-mechanisms/05-memory-and-faults.md) | Planned | Linker flags pending CMake integration |
| Fault Domains / Power Modeling | [`../02-mechanisms/05-memory-and-faults.md`](../02-mechanisms/05-memory-and-faults.md) | Stub | Wave 3 ABI stubs |
| Physical Degradation (Jitter/RC/Warmup) | [`../02-mechanisms/06-physical-degradation.md`](../02-mechanisms/06-physical-degradation.md) | Partial | Jitter/RC/Warmup Landed; Power is Stub |
| PinArbiter / Configuration Boundaries | [`../02-mechanisms/07-peripheral-registry.md`](../02-mechanisms/07-peripheral-registry.md) | Partial | PinArbiter Landed; SchemaForm is Partial |
| Power Domain Lifecycles | [`../02-mechanisms/07-peripheral-registry.md`](../02-mechanisms/07-peripheral-registry.md) | Planned | Design specification |
| Channels 1 Pin / 1b PWM / 2 Bus Routing | [`../02-mechanisms/08-channel-routing.md`](../02-mechanisms/08-channel-routing.md) | Partial | Channels 1/1b/2 Landed; 3/4 Planned |
| Axis C Timers / PWM / FOC Stepping | [`../02-mechanisms/09-timer-and-pwm-semantics.md`](../02-mechanisms/09-timer-and-pwm-semantics.md) | Partial | Duty Landed; `pal_hwtimer` is Partial |
| Wasm↔JS ABI Contracts & Anti-Drift | [`../02-mechanisms/10-wasm-js-bridge-abi.md`](../02-mechanisms/10-wasm-js-bridge-abi.md) | Landed | Sub-items may contain Stubs (Power) |
| Accuracy Modes (behavioral/timing/cycle) | [`../02-mechanisms/11-accuracy-observation-lifecycle.md`](../02-mechanisms/11-accuracy-observation-lifecycle.md) | Partial | SSOT active; CI evidence pending |
| Observability Plane (VCD/Recorder) | [`../02-mechanisms/11-accuracy-observation-lifecycle.md`](../02-mechanisms/11-accuracy-observation-lifecycle.md) | Partial | Evidence validity rules documented |
| Lifecycle / Reset / Multi-Wasm Scope | [`../02-mechanisms/11-accuracy-observation-lifecycle.md`](../02-mechanisms/11-accuracy-observation-lifecycle.md) | Partial | Cold-boot gates require strengthening |

---

## 2. Phase Milestones & Exit Criteria

| Phase | Core Deliverables | Fidelity Target | Primary C Categories |
|---|---|---|---|
| **Phase 1 (MVP+)** | Virtual clock, physical injection, fast-forwarding | Virtual-Time Fidelity | C1, C2, C13, C14, C15 |
| **Phase 2 (Wave A)** | Heap quotas, Sanitizers, stack watermarks | Resource Parity | C6, C25 |
| **Phase 3 (Wave B)** | Single-source drivers, async DMA, bus fault state machines | Protocol Parity | C7, C8, C18, C19 |
| **Phase 4 (Wave C)** | Chaotic scheduler, TSan, soft WDT, OS semantics | Temporal Parity | C3, C4, C5, C9, C16, C20 |
| **Phase 5 (Wave D)** | Instruction & ABI dual-track verification | Instruction Parity | C12, C24 |

### 2.1 Phase Exit Criteria

- **Phase 1 Exit**: (1) C2/C14 verification entries bound in PR gates; (2) C13.1 cold-boot vectors reproducible with 0 residue across successive `INIT` calls; (3) C15 Fail-Loud paths have automated regressions.
- **Phase 2 Exit**: (1) ADR-0045 fixed-heap flags integrated in CMake; (2) Tier 1 ASan pass green; (3) $\ge 1$ physical golden vector annotated with `fp_mode`.
- **Phase 3 Exit**: (1) C8 asynchronous transfer windows backed by reproducible tests; (2) C18 bus fault injection suite merged into Tier 2; (3) C7.4 bypass audit command operational.
- **Phase 4 Exit**: (1) Known race suites trigger Faults under chaotic scheduling + TSan; (2) Critical section escapes eliminated; (3) C5.2 soft WDT traps lockups; (4) C16 primitives verified against compatibility tables.
- **Phase 5 Exit**: (1) Nightly ABI dual-track suites active; (2) Struct padding bugs caught on nightly runs; (3) Daily fast runs make no false instruction-level claims.

---

## 3. CI Test Tiers

| Tier | Target Latency | Trigger | Core Coverage | Validation Method |
|---|---|---|---|---|
| **Tier 1 (PR Gate)** | <15s | Per push / PR | C1, C2, C5.1, C6 (ASan/Quotas), C13.1 (Cold Boot), C14.1 (Single Gate), C15 (Fail-Loud) | Static asserts, fast HEADLESS unit tests, ASan Pass 1 |
| **Tier 2 (Nightly Chaos)** | <15min | Nightly | C3 (Chaos + TSan), C4 (Interrupts), C7, C8 (Async DMA), C16 (OS Semantics), C18, C19 | Multi-seed chaos regressions, TSan concurrency, bus fault injection |
| **Tier 3 (Deep HIL)** | As-needed / Weekly | Pre-release | C10 (FOC Motor HIL), C12 (RISC-V32 Emulator Traces), C22 (Power), C24 (DMA RAM) | Instruction-level trace diffs, physical HIL hardware test benches |

---

## 4. Sub-Scenario Maintenance Procedures

1. **Adding Sub-Scenarios**: Author all 5 fields in [`01-consistency-spec.md`](./01-consistency-spec.md), then add an entry in [`02-consistency-checklist.md`](./02-consistency-checklist.md) (Status defaults to ❌/🟡, verification entry to `Pending`).
2. **Promoting to ✅**: Requires: (a) Non-pending verification entry point; (b) PR explicitly citing acceptance oracle from `01`; (c) Reviewer ability to reproduce test locally.
3. **No Double-Writing**: Specifications reside in `01`; statuses reside in `02`; roadmap resides in `03`.

### 4.1 Golden Vector Governance

1. **Repository Tracking**: All golden vectors (integer traces and floating-point vectors annotated with `fp_mode`) must be checked into version control.
2. **Updates**: PRs modifying golden baselines must explain algorithmic rationale and reference corresponding C scenario IDs (e.g., C2.5, C25.3).
3. **Strict CI Assertions**: CI fails immediately on golden trace diffs; automatic baseline rebasing in CI is forbidden.
4. **Peer Review**: Golden updates require explicit code review.

---

## 5. Documentation Governance (2.0 $\rightarrow$ 3.0)

### 5.1 4-Layer SSOT Boundaries

| Information | Sole Source of Truth |
|---|---|
| Axes A~F Definitions & Production Contract | [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md), [`../01-overview/03-production-contract.md`](../01-overview/03-production-contract.md) |
| Maturity Vocabulary | Root [`../00-README.md` §3.2](../00-README.md) |
| Maturity Master Table | **This Document (§1.1)** |
| Mechanism Implementations | [`../02-mechanisms/`](../02-mechanisms/00-README.md) |
| Lean Axis Indices | [`../03-axes/`](../03-axes/00-README.md) |
| C Scenario Technical Specifications | [`01-consistency-spec.md`](./01-consistency-spec.md) |
| C Scenario Status Matrix & Entries | [`02-consistency-checklist.md`](./02-consistency-checklist.md) |
| Phase Roadmaps & CI Governance | **This Document (§0, §2–§4)** |

---

## 6. Revision History

| Date | Changes |
|---|---|
| 2026-08-02 | 2.0 Historical Migration: Modularized architecture, maturity master tables, and Accuracy Mode specifications. |
| 2026-08-02 | **Wave 4A**: Migrated to 3.0 `04-assurance/03`; realigned mechanism maturity tables; added ADRs 0053/0054/0055. |
| 2026-08-02 | **Wave 4C**: Migrated `02-consistency-checklist.md` status matrix (98 sub-scenarios); verified anchor references. |
| 2026-08-02 | **Assurance Review**: Expanded sub-scenarios 98 $\rightarrow$ 102 (C1.5/C2.5/C13.5/C21.4); added single-symbol status rules, phase exit criteria, and golden governance. |
| 2026-08-02 | **Active Switch**: Completed C25 5-field specifications; archived 1.0/2.0 trees; switched UniSim 3.0 to Active. |
