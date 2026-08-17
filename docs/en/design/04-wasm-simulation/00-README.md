# Wasm Simulation & Frontend Runtime Engine (UniSim) — 3.0 SSOT

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/00-README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (Path: `docs/design/04-wasm-simulation/`) |
| **Status** | **Active** (Switched 2026-08-02; Active SSOT entry; 2026-08-11 Amend revised) |
| Ancestor | `04-wasm-simulation-2.0/` (2.0, formerly Active; archived and removed 2026-08-02); [04-wasm-simulation/](../04-wasm-simulation/) (1.0, **Archived**, historical reference) |
| Associated ADRs | 0002, 0003, 0009, 0013, 0014, 0019, 0025, 0040, 0042, 0045, 0047 |
| Associated Code | `wink-micro-os/osal/wasm/`, `wink-micro-os/targets/{wasm,common}/`, `@wink-ai/unisim` (**UniSim Simulation Engine Core**; standalone TS SDK package contract, governed per module per §4.1) |
| Last Audit | 2026-08-11 Amend (Embedded architecture review patch: PWM Channel 1b reclassification, degradation non-loss rule, IRQ/DMA/Timer control plane) |

> **Active Entry Point**: UniSim 3.0 was promoted to **Active** on 2026-08-02 via §7 quality gates, serving as the active SSOT entry for Wasm simulation architecture. On 2026-08-11, **Amend** revisions refined PWM classification (Channel 1b), mandated that "behavioral degradation must preserve pulse/distance semantics," and completed the control-plane triad (IRQ/DMA/Timer). Corresponding TypeScript specifications reside in `wink-ai/packages/unisim/docs/design/unified-peripheral-channel-architecture.md`.

---

## 0. Why UniSim 3.0 Four-Tier Layering over Flat 01–15

UniSim 2.0 used a flat numerical sequence across orthogonal indices (Mechanisms / Axes A~F / Scenarios C), causing confusion regarding primary ownership.

UniSim 3.0 uses **physical directory partitioning** to bind four distinct responsibilities:

| Layer | Directory | Questions Addressed | Density | Allows Body Text? |
|---|---|---|---|---|
| **Ⅰ Overview** | [`01-overview/`](./01-overview/) | Concepts, architecture, methodology, scope, lexicon | Medium | Yes (Definitions & scope) |
| **Ⅱa Mechanisms** | [`02-mechanisms/`](./02-mechanisms/) | Engine subsystem implementation details | **Dense** | **Yes (Implementation SSOT)** |
| **Ⅱb Fidelity Axes** | [`03-axes/`](./03-axes/) | Guarantees and upper bounds per Axis A~F | **Lean** | Index & bounds only; **bans duplicating mechanism text** |
| **Ⅲ Assurance** | [`04-assurance/`](./04-assurance/) | Verification scope, status matrices, roadmap governance | Medium | Yes (Scenarios / status / procedures) |

```text
Claim: "High Fidelity"
    │
    ├─ Read Ⅰ  → Scope & boundaries (Completeness ≠ Identity)
    ├─ Check Ⅱb by Axis A~F → Upper bounds + links to mechanisms/scenarios
    ├─ Engine devs read Ⅱa → Unique implementation SSOT
    └─ QA reads Ⅲ → Contract C scenarios / status matrix / CI
```

---

## 1. Directory Tree

```text
04-wasm-simulation/
├── 00-README.md                          ← This document: Entry + SSOT Rules + Lexicon
├── 01-overview/                          ← Ⅰ Overview & Architecture
│   ├── 00-README.md
│   ├── 01-architecture.md
│   ├── 02-axes-af.md                     ← Axes A~F Definitions (SSOT)
│   ├── 03-production-contract.md
│   ├── 04-methodology.md
│   └── 05-glossary.md                    ← Authoritative Glossary
├── 02-mechanisms/                        ← Ⅱa Engine Mechanisms (Implementation SSOT)
│   ├── 00-README.md
│   ├── 01-sandbox-and-execution.md
│   ├── 02-virtual-clock.md
│   ├── 03-scheduler-and-concurrency.md
│   ├── 04-interrupt-model.md
│   ├── 05-memory-and-faults.md
│   ├── 06-physical-degradation.md
│   ├── 07-peripheral-registry.md
│   ├── 08-channel-routing.md             ← Axis A Data Plane (Includes PWM Channel 1b)
│   ├── 09-timer-and-pwm-semantics.md     ← Axis C Primary Mechanism (Soft stepping / capture)
│   ├── 10-wasm-js-bridge-abi.md
│   └── 11-accuracy-observation-lifecycle.md
├── 03-axes/                              ← Ⅱb Lean Axis Indexes (No text duplication)
│   ├── 00-README.md
│   ├── A-peripheral-source.md
│   ├── B-timebase.md
│   ├── C-timer-semantics.md
│   ├── D-interrupt-model.md
│   ├── E-scheduler-concurrency.md
│   └── F-fault-and-observation.md
└── 04-assurance/                         ← Ⅲ Assurance & Governance
    ├── 00-README.md
    ├── 01-consistency-spec.md
    ├── 02-consistency-checklist.md
    └── 03-roadmap-and-governance.md
```

---

## 2. SSOT Rules

1. **One Truth, One Location**: Technical facts reside in exactly one file; other files link to it.
2. **Asymmetry between Ⅱa & Ⅱb**: Mechanisms contain dense implementations; axis pages contain fixed templates only.
3. **Exactly One Primary Home per Axis**: Each axis points to **exactly one** primary mechanism file. A mechanism acts as primary for at most **0 or 1** axis.
4. **Overview ↔ Axis Page Asymmetry**:
   - [`01-overview/02-axes-af.md`](./01-overview/02-axes-af.md): Letter **definitions** + comparison table;
   - `03-axes/X`: Expanded upper bounds; **never alters definition wording**.
5. **Axes A~F definitions** reside exclusively in `02-axes-af.md`; glossary definitions reside in [`01-overview/05-glossary.md`](./01-overview/05-glossary.md).
6. **Scenario Statuses** reside exclusively in [`04-assurance/02-consistency-checklist.md`](./04-assurance/02-consistency-checklist.md); specifications avoid inline status emojis.
7. **Maturity Tags** use §3 vocabulary only; roadmap table lives in [`04-assurance/03-roadmap-and-governance.md`](./04-assurance/03-roadmap-and-governance.md).
8. **Active Status**: 3.0 is the active SSOT; 1.0 is Archived; 2.0 is removed.
9. **STRICT_NONBLOCKING**: Explanations live in methodology; build integration lives in sandbox/scheduler with bidirectional links.
10. **Code Changes Trigger Documentation Updates**: Governed per §4.4.

---

## 3. Two Orthogonal Vocabularies

### 3.1 Document Lifecycle States (Directory / File Level)

| Tag | Meaning |
|---|---|
| **Scaffold** | Directory skeleton and frontmatter template only |
| **Migrating** | In-flight migration; not active public entry |
| **Active** | Active SSOT entry |
| **Archived** | Read-only historical reference |

### 3.2 Implementation Maturity Vocabulary (Mechanism Landing State)

| Tag | Meaning |
|---|---|
| **Landed** | End-to-end operational with verified source paths and tests |
| **Partial** | Operational on primary path with known gaps or limitations |
| **Stub** | Frozen ABI / interfaces with empty or unrouted implementations |
| **Planned** | Design only; no implementation commitment |
| **Deprecated** | Legacy code; new usage forbidden |

---

## 4. Mandatory Frontmatter Metadata

### 4.1 `02-mechanisms/*.md` (Implementation Documents)

| Field | Requirement |
|---|---|
| **Landed** | Vocabulary term from §3.2 |
| **Associated Code** | C-side relative workspace paths; TS-side `@wink-ai/unisim` module names |
| **Last Audit** | `YYYY-MM-DD` alignment date |
| **Governing ADRs** | Specific binding ADRs |
| **Supporting Axes** | Primary / secondary axis letters |

---

## 5. Lean Axis Page Guardrails

| Rule | Description |
|---|---|
| No Fenced Code Blocks | Algorithms belong in mechanisms |
| Target Line Count ≤ 120 | Move overflows to mechanisms or overview |
| No Status Emojis | Statuses belong in checklist |
| No Maturity Tags | Maturity belongs in mechanisms frontmatter and roadmap |
| Primary Link Matches Table | Matches `03-axes/00-README.md` |

---

## 6. Mapping from 2.0 to 3.0

| 3.0 Target | Primary 2.0 Source |
|---|---|
| `01-overview/01-architecture.md` | `01-architecture.md` |
| `01-overview/02-axes-af.md` | `00-README.md` §1 |
| `01-overview/03-production-contract.md` | `00` §2–§3; `11` Scope |
| `01-overview/04-methodology.md` | `00` §0/§4; `11` §0.1–§0.3 |
| `01-overview/05-glossary.md` | Extracted terminology |
| `02-mechanisms/01`…`08` | `02`…`09` |
| `02-mechanisms/09-timer-and-pwm-semantics.md` | `09` §1.4/§5.3 & ADR-0047 |
| `02-mechanisms/10-wasm-js-bridge-abi.md` | `10-wasm-js-bridge-abi.md` |
| `02-mechanisms/11-accuracy-…` | `15-accuracy-observation-lifecycle.md` |
| `03-axes/A`…`F` | Lean axis pages |
| `04-assurance/01`…`03` | `11` / `12` / `13` |

---

## 7. Migration Checklist Gate (Passed 2026-08-02)

- [x] Overview definitions and production contracts finalized
- [x] Mechanisms associated code and audit metadata populated
- [x] Axis C primary link directed to `09-timer-and-pwm-semantics.md`
- [x] Assurance C-scenario anchors and checklists complete
- [x] 3.0 promoted to Active SSOT

---

## 8. Migration Record & Next Steps

1. **Waves 1–4 Completed**: Overview, mechanisms `01`–`11`, axes A–F, and assurance `01`–`03` migrated and closed.
2. **Mechanism Review Closures**: B-tier ADRs ([ADR-0053](../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md), [0054](../../decisions/unisim/0054-sim-uart-async-rx-model-boundary.md), [0055](../../decisions/unisim/0055-sim-fp-determinism-and-golden-policy.md)) accepted and backported.
3. **Ongoing Governance**: Lean axis linting and automated documentation-code sync warnings.
